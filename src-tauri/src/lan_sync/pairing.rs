use super::handshake::{Session, SessionWriter, HANDSHAKE_TIMEOUT};
use super::manager::{ManagerEvent, LINGER};
use super::peers::encode_hex32;
use super::protocol::{Frame, GroupGrant, Hello, Pair, PairInfo};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{sleep_until, timeout, Instant};
use tokio_util::task::AbortOnDropHandle;

pub const PAIR_WINDOW: Duration = Duration::from_secs(300);
pub const PAIR_CONFIRM_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_secs(3)
} else {
    Duration::from_secs(120)
};
pub const PAIR_RATE: usize = 3;
pub const PAIR_RATE_WINDOW: Duration = Duration::from_secs(60);
pub const PAIR_ATTEMPTS: u32 = 5;
const PAIR_FRAME_MAX: usize = 64 * 1024;
const INBOX: usize = 4;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Host,
    Joiner,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PairRefusal {
    AccountDevice,
    BothGrouped,
    AlreadyPaired,
    TimedOut,
    Cancelled,
    Busy,
    TooManyAttempts,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum PairEvent {
    #[serde(rename_all = "camelCase")]
    Code {
        sas: u32,
        role: Role,
        peer_id: String,
        peer_key: String,
        peer_name: String,
        peer_platform: String,
        peer_entities: u32,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        reverify: bool,
    },
    PeerConfirmed,
    Granted {
        grant: GroupGrant,
    },
    Done,
    Ended {
        reason: PairRefusal,
    },
    Closed {
        reason: PairRefusal,
    },
}

pub(super) async fn emit(events: &mpsc::Sender<ManagerEvent>, event: PairEvent) {
    let _ = events.send(ManagerEvent::Pair(event)).await;
}

pub enum PairAction {
    Confirm(Option<GroupGrant>, oneshot::Sender<Result<(), String>>),
    Cancel,
}

#[derive(Debug, PartialEq)]
pub enum PairEnd {
    Paired,
    Refused(PairRefusal),
    Unanswered,
    Failed(PairRefusal),
    Dropped,
}

pub struct PairCall<'a> {
    pub my_id: &'a str,
    pub mine: &'a PairInfo,
    pub peer: &'a Hello,
    pub sas: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PairStep {
    Waiting,
    PeerConfirmed,
    Ready,
    Granted(GroupGrant),
}

pub fn role(
    me: &PairInfo,
    my_id: &str,
    peer: &PairInfo,
    peer_id: &str,
) -> Result<Role, PairRefusal> {
    if me.mode == "account" || peer.mode == "account" {
        return Err(PairRefusal::AccountDevice);
    }
    let larger = || {
        let mine = (me.entities, std::cmp::Reverse(my_id));
        let theirs = (peer.entities, std::cmp::Reverse(peer_id));
        if mine > theirs {
            Role::Host
        } else {
            Role::Joiner
        }
    };
    match (&me.group, &peer.group) {
        (Some(a), Some(b)) if a == b => match (me.reverify, peer.reverify) {
            (false, false) => Err(PairRefusal::AlreadyPaired),
            (true, false) => Ok(Role::Host),
            (false, true) => Ok(Role::Joiner),
            (true, true) => Ok(larger()),
        },
        (Some(_), Some(_)) => Err(PairRefusal::BothGrouped),
        (Some(_), None) => Ok(Role::Host),
        (None, Some(_)) => Ok(Role::Joiner),
        (None, None) => Ok(larger()),
    }
}

pub struct PairFlow {
    role: Role,
    local_ok: bool,
    peer_ok: bool,
    done: bool,
}

impl PairFlow {
    pub fn new(role: Role) -> Self {
        Self {
            role,
            local_ok: false,
            peer_ok: false,
            done: false,
        }
    }

    pub fn is_ready(&self) -> bool {
        !self.done && self.local_ok && self.peer_ok
    }

    pub fn local_confirm(&mut self) -> Vec<Frame> {
        if self.done || self.local_ok {
            return Vec::new();
        }
        self.local_ok = true;
        vec![Frame::Pair(Pair::Confirm)]
    }

    pub fn local_cancel(&mut self) -> Frame {
        self.done = true;
        Frame::Pair(Pair::Cancel)
    }

    pub fn on_frame(&mut self, f: &Frame) -> Result<PairStep, PairRefusal> {
        if self.done {
            return Err(PairRefusal::Cancelled);
        }
        let step = self.step(f);
        self.done = matches!(step, Err(_) | Ok(PairStep::Granted(_)));
        step
    }

    fn step(&mut self, f: &Frame) -> Result<PairStep, PairRefusal> {
        match f {
            Frame::Pair(Pair::Confirm) => {
                self.peer_ok = true;
                Ok(if self.local_ok {
                    PairStep::Ready
                } else {
                    PairStep::PeerConfirmed
                })
            }
            Frame::Pair(Pair::Cancel) => Err(PairRefusal::Cancelled),
            Frame::Group(grant) if self.role == Role::Joiner && self.is_ready() => {
                Ok(PairStep::Granted(grant.clone()))
            }
            Frame::Group(_) => Err(PairRefusal::Cancelled),
            _ => Ok(PairStep::Waiting),
        }
    }
}

fn check_grant(role: Role, offered: Option<&GroupGrant>) -> Result<(), String> {
    match (role, offered) {
        (Role::Host, Some(grant)) => grant.validate().map_err(|e| e.to_string()),
        (Role::Joiner, None) => Ok(()),
        (Role::Host, None) => Err("the host must send the group grant".into()),
        (Role::Joiner, Some(_)) => Err("only the host sends a group grant".into()),
    }
}

struct Talk<'a> {
    writer: SessionWriter,
    inbox: mpsc::Receiver<Frame>,
    events: &'a mpsc::Sender<ManagerEvent>,
}

impl Talk<'_> {
    async fn emit(&mut self, event: PairEvent) {
        emit(self.events, event).await;
    }

    async fn send(&mut self, frame: &Frame) -> bool {
        self.writer.send(frame).await.is_ok()
    }

    // Waits for the peer to hang up so our last frame is not lost to a reset; false if it cancelled instead.
    async fn part(&mut self, last: &Frame) -> bool {
        if !self.send(last).await {
            return false;
        }
        let hangup = async {
            while let Some(frame) = self.inbox.recv().await {
                if frame == Frame::Pair(Pair::Cancel) {
                    return false;
                }
            }
            true
        };
        timeout(LINGER, hangup).await.unwrap_or(true)
    }
}

pub async fn run_pair(
    session: Session,
    call: PairCall<'_>,
    mut actions: mpsc::Receiver<PairAction>,
    events: &mpsc::Sender<ManagerEvent>,
) -> PairEnd {
    let (mut reader, writer) = session.split();
    let (tx, inbox) = mpsc::channel(INBOX);
    let _reading = AbortOnDropHandle::new(tokio::spawn(async move {
        while let Ok(frame) = reader.recv_max(PAIR_FRAME_MAX).await {
            if frame == Frame::Bye || tx.send(frame).await.is_err() {
                return;
            }
        }
    }));
    let mut talk = Talk {
        writer,
        inbox,
        events,
    };
    converse(&mut talk, call, &mut actions).await
}

async fn converse(
    talk: &mut Talk<'_>,
    call: PairCall<'_>,
    actions: &mut mpsc::Receiver<PairAction>,
) -> PairEnd {
    if !talk.send(&Frame::Pair(Pair::Info(call.mine.clone()))).await {
        return PairEnd::Unanswered;
    }
    let theirs = match timeout(HANDSHAKE_TIMEOUT, talk.inbox.recv()).await {
        Ok(Some(Frame::Pair(Pair::Info(theirs)))) => theirs,
        _ => return PairEnd::Unanswered,
    };
    let role = match role(call.mine, call.my_id, &theirs, &call.peer.device_id) {
        Ok(role) => role,
        Err(reason) => return PairEnd::Refused(reason),
    };
    let cancel = Frame::Pair(Pair::Cancel);
    if actions.is_closed() {
        talk.part(&cancel).await;
        return PairEnd::Failed(PairRefusal::Cancelled);
    }
    talk.emit(PairEvent::Code {
        sas: call.sas,
        role,
        peer_id: call.peer.device_id.clone(),
        peer_key: encode_hex32(&call.peer.device_key),
        peer_name: call.peer.device_name.clone(),
        peer_platform: call.peer.platform.clone(),
        peer_entities: theirs.entities,
        reverify: call.mine.group.is_some() && call.mine.group == theirs.group,
    })
    .await;
    let mut flow = PairFlow::new(role);
    let mut grant = None;
    let deadline = Instant::now() + PAIR_CONFIRM_TIMEOUT;
    loop {
        tokio::select! {
            frame = talk.inbox.recv() => {
                let Some(frame) = frame else {
                    return PairEnd::Dropped;
                };
                match flow.on_frame(&frame) {
                    Ok(PairStep::Waiting) => {}
                    Ok(PairStep::PeerConfirmed | PairStep::Ready) => {
                        talk.emit(PairEvent::PeerConfirmed).await;
                    }
                    Ok(PairStep::Granted(grant)) => {
                        talk.emit(PairEvent::Granted { grant }).await;
                        return PairEnd::Paired;
                    }
                    Err(reason) => {
                        if frame != cancel {
                            talk.part(&cancel).await;
                        }
                        return PairEnd::Failed(reason);
                    }
                }
            }
            action = actions.recv() => match action {
                Some(PairAction::Confirm(offered, reply)) => {
                    let checked = check_grant(role, offered.as_ref());
                    if checked.is_ok() {
                        for frame in flow.local_confirm() {
                            if !talk.send(&frame).await {
                                let _ = reply.send(Err("the other device left".into()));
                                return PairEnd::Dropped;
                            }
                        }
                        grant = grant.or(offered);
                    }
                    let _ = reply.send(checked);
                }
                Some(PairAction::Cancel) | None => {
                    talk.part(&flow.local_cancel()).await;
                    return PairEnd::Failed(PairRefusal::Cancelled);
                }
            },
            () = sleep_until(deadline) => {
                talk.part(&flow.local_cancel()).await;
                return PairEnd::Failed(PairRefusal::TimedOut);
            }
        }
        if flow.is_ready() {
            if let Some(grant) = grant.take() {
                if !talk.part(&Frame::Group(grant)).await {
                    return PairEnd::Dropped;
                }
                talk.emit(PairEvent::Done).await;
                return PairEnd::Paired;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan_sync::protocol::{EpochSecret, GroupGrant};

    fn info(mode: &str, group: Option<&str>, entities: u32) -> PairInfo {
        PairInfo {
            mode: mode.into(),
            group: group.map(Into::into),
            entities,
            members: 0,
            reverify: false,
        }
    }

    fn grant() -> GroupGrant {
        GroupGrant {
            group_id: "g".into(),
            vault_key: "ab".repeat(32),
            secrets: vec![EpochSecret {
                epoch: 1,
                secret: "cd".repeat(32),
            }],
            host_name: "A".into(),
        }
    }

    #[test]
    fn role_table() {
        let none = |n| info("none", None, n);
        let grouped = |g| info("none", Some(g), 1);
        let r = |a: &PairInfo, ai, b: &PairInfo, bi| role(a, ai, b, bi);
        assert_eq!(r(&grouped("g"), "b", &none(99), "a"), Ok(Role::Host));
        assert_eq!(r(&none(99), "a", &grouped("g"), "b"), Ok(Role::Joiner));
        assert_eq!(r(&none(5), "b", &none(2), "a"), Ok(Role::Host));
        assert_eq!(r(&none(2), "b", &none(5), "a"), Ok(Role::Joiner));
        assert_eq!(r(&none(2), "a", &none(2), "b"), Ok(Role::Host));
        assert_eq!(r(&none(2), "b", &none(2), "a"), Ok(Role::Joiner));
        assert_eq!(
            r(&grouped("g"), "a", &grouped("g"), "b"),
            Err(PairRefusal::AlreadyPaired)
        );
        let reverify = |n| PairInfo {
            reverify: true,
            ..info("none", Some("g"), n)
        };
        assert_eq!(r(&reverify(1), "a", &grouped("g"), "b"), Ok(Role::Host));
        assert_eq!(r(&grouped("g"), "a", &reverify(1), "b"), Ok(Role::Joiner));
        assert_eq!(r(&reverify(5), "b", &reverify(2), "a"), Ok(Role::Host));
        assert_eq!(r(&reverify(2), "b", &reverify(5), "a"), Ok(Role::Joiner));
        assert_eq!(
            r(&reverify(1), "a", &info("none", Some("h"), 1), "b"),
            Err(PairRefusal::BothGrouped)
        );
        assert_eq!(
            r(&grouped("g"), "a", &grouped("h"), "b"),
            Err(PairRefusal::BothGrouped)
        );
        assert_eq!(
            r(&none(1), "a", &info("account", None, 1), "b"),
            Err(PairRefusal::AccountDevice)
        );
        assert_eq!(
            r(&info("account", None, 1), "a", &grouped("g"), "b"),
            Err(PairRefusal::AccountDevice)
        );
        assert_eq!(
            r(&grouped("g"), "a", &info("account", Some("g"), 1), "b"),
            Err(PairRefusal::AccountDevice)
        );
    }

    #[test]
    fn refusal_and_role_serialise_camel_case() {
        assert_eq!(serde_json::to_string(&Role::Joiner).unwrap(), r#""joiner""#);
        assert_eq!(
            serde_json::to_string(&PairRefusal::TooManyAttempts).unwrap(),
            r#""tooManyAttempts""#
        );
    }

    #[test]
    fn confirm_order_does_not_matter() {
        let confirm = Frame::Pair(Pair::Confirm);
        let mut a = PairFlow::new(Role::Joiner);
        assert_eq!(a.local_confirm(), vec![confirm.clone()]);
        assert_eq!(a.on_frame(&confirm), Ok(PairStep::Ready));
        let mut b = PairFlow::new(Role::Host);
        assert_eq!(b.on_frame(&confirm), Ok(PairStep::PeerConfirmed));
        b.local_confirm();
        assert!(b.is_ready());
        assert_eq!(b.on_frame(&Frame::Nudge), Ok(PairStep::Waiting));
    }

    #[test]
    fn cancel_ends_both_sides() {
        let mut f = PairFlow::new(Role::Host);
        assert_eq!(
            f.on_frame(&Frame::Pair(Pair::Cancel)),
            Err(PairRefusal::Cancelled)
        );
        assert_eq!(f.local_cancel(), Frame::Pair(Pair::Cancel));
    }

    fn confirmed(role: Role) -> PairFlow {
        let mut f = PairFlow::new(role);
        f.local_confirm();
        f.on_frame(&Frame::Pair(Pair::Confirm)).unwrap();
        f
    }

    #[test]
    fn grant_before_ready_is_refused() {
        let g = Frame::Group(grant());
        assert!(PairFlow::new(Role::Joiner).on_frame(&g).is_err());
        let mut j = PairFlow::new(Role::Joiner);
        j.local_confirm();
        assert!(j.on_frame(&g).is_err());
        let mut j = confirmed(Role::Joiner);
        assert_eq!(j.on_frame(&g), Ok(PairStep::Granted(grant())));
        assert!(confirmed(Role::Host).on_frame(&g).is_err());
    }

    #[test]
    fn second_grant_is_refused() {
        let g = Frame::Group(grant());
        let mut j = confirmed(Role::Joiner);
        assert!(j.on_frame(&g).is_ok());
        assert!(!j.is_ready());
        assert_eq!(j.on_frame(&g), Err(PairRefusal::Cancelled));
    }

    #[test]
    fn nothing_proceeds_after_cancel() {
        let g = Frame::Group(grant());
        let confirm = Frame::Pair(Pair::Confirm);

        let mut peer_cancelled = PairFlow::new(Role::Joiner);
        peer_cancelled.local_confirm();
        assert!(peer_cancelled.on_frame(&Frame::Pair(Pair::Cancel)).is_err());
        assert!(peer_cancelled.on_frame(&confirm).is_err());
        assert!(peer_cancelled.on_frame(&g).is_err());
        assert!(!peer_cancelled.is_ready());

        let mut local_cancelled = PairFlow::new(Role::Joiner);
        local_cancelled.local_confirm();
        local_cancelled.local_cancel();
        assert!(local_cancelled.on_frame(&confirm).is_err());
        assert!(local_cancelled.on_frame(&g).is_err());
        assert!(!local_cancelled.is_ready());
        assert!(local_cancelled.local_confirm().is_empty());
    }

    #[test]
    fn pair_events_carry_a_state_tag() {
        let json = |e: PairEvent| serde_json::to_value(e).unwrap();
        let code = PairEvent::Code {
            sas: 123456,
            role: Role::Joiner,
            peer_id: "a".into(),
            peer_key: "ab".repeat(32),
            peer_name: "A".into(),
            peer_platform: "linux".into(),
            peer_entities: 3,
            reverify: false,
        };
        assert_eq!(
            json(code),
            serde_json::json!({"state": "code", "sas": 123456, "role": "joiner",
                "peerId": "a", "peerKey": "ab".repeat(32),
                "peerName": "A", "peerPlatform": "linux", "peerEntities": 3})
        );
        assert_eq!(
            json(PairEvent::PeerConfirmed),
            serde_json::json!({"state": "peerConfirmed"})
        );
        assert_eq!(json(PairEvent::Done), serde_json::json!({"state": "done"}));
        assert_eq!(
            json(PairEvent::Closed {
                reason: PairRefusal::TimedOut
            }),
            serde_json::json!({"state": "closed", "reason": "timedOut"})
        );
        let reason = PairRefusal::TooManyAttempts;
        assert_eq!(
            json(PairEvent::Ended { reason }),
            serde_json::json!({"state": "ended", "reason": "tooManyAttempts"})
        );
        let granted = json(PairEvent::Granted { grant: grant() });
        assert_eq!(granted["state"], "granted");
        assert_eq!(granted["grant"]["groupId"], "g");
    }

    #[test]
    fn only_the_host_offers_a_valid_grant() {
        assert!(check_grant(Role::Host, Some(&grant())).is_ok());
        assert!(check_grant(Role::Joiner, None).is_ok());
        assert!(check_grant(Role::Host, None).is_err());
        assert!(check_grant(Role::Joiner, Some(&grant())).is_err());
        let mut bad = grant();
        bad.secrets.clear();
        assert!(check_grant(Role::Host, Some(&bad)).is_err());
    }

    #[test]
    fn local_confirm_emits_once() {
        let mut f = PairFlow::new(Role::Host);
        assert_eq!(f.local_confirm().len(), 1);
        assert!(f.local_confirm().is_empty());
    }
}
