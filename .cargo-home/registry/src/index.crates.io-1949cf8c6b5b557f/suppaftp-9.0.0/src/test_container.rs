#![allow(dead_code)]

use std::borrow::Cow;

use testcontainers::core::{CmdWaitFor, ContainerPort, ExecCommand, WaitFor};
use testcontainers::{Container, ContainerAsync, Image};

#[derive(Debug, Default, Clone)]
struct AlpineFtpServer;

impl Image for AlpineFtpServer {
    fn name(&self) -> &str {
        "delfer/alpine-ftp-server"
    }

    fn tag(&self) -> &str {
        "latest"
    }

    fn ready_conditions(&self) -> Vec<WaitFor> {
        vec![WaitFor::message_on_either_std("passwd:")]
    }

    fn expose_ports(&self) -> &[ContainerPort] {
        &[
            ContainerPort::Tcp(21),
            ContainerPort::Tcp(30_000),
            ContainerPort::Tcp(30_001),
            ContainerPort::Tcp(30_002),
            ContainerPort::Tcp(30_003),
            ContainerPort::Tcp(30_004),
            ContainerPort::Tcp(30_005),
            ContainerPort::Tcp(30_006),
            ContainerPort::Tcp(30_007),
            ContainerPort::Tcp(30_008),
            ContainerPort::Tcp(30_009),
        ]
    }

    fn env_vars(
        &self,
    ) -> impl IntoIterator<Item = (impl Into<Cow<'_, str>>, impl Into<Cow<'_, str>>)> {
        vec![
            ("USERS", "test|test|/home/test"),
            ("ADDRESS", "127.0.0.1"),
            ("MIN_PORT", "30000"),
            ("MAX_PORT", "30009"),
        ]
    }
}

pub struct AsyncPureFtpRunner {
    container: ContainerAsync<AlpineFtpServer>,
}

impl AsyncPureFtpRunner {
    pub async fn start() -> Self {
        use testcontainers::runners::AsyncRunner;
        let container = AlpineFtpServer::default()
            .start()
            .await
            .expect("Failed to start container");
        let resp = container
            .exec(
                ExecCommand::new(["/bin/mkdir", "-p", "/home/test/invalid-utf8"])
                    .with_cmd_ready_condition(CmdWaitFor::Exit { code: Some(0) }),
            )
            .await
            .expect("Failed to create directory");
        assert_eq!(
            resp.exit_code()
                .await
                .expect("failed to get exit code for mkdir")
                .expect("no exit code for mkdir"),
            0
        );
        let resp = container
            .exec(
                ExecCommand::new(["/bin/touch", "/home/test/invalid-utf8/caf\\303\\251.txt"])
                    .with_cmd_ready_condition(CmdWaitFor::Exit { code: Some(0) }),
            )
            .await
            .expect("Failed to create file");
        assert_eq!(
            resp.exit_code()
                .await
                .expect("failed to get exit code for touch")
                .expect("no exit code for touch"),
            0
        );
        Self { container }
    }

    pub async fn get_ftp_port(&self) -> u16 {
        self.container.get_host_port_ipv4(21).await.unwrap()
    }

    pub async fn get_mapped_port(&self, port: u16) -> u16 {
        self.container.get_host_port_ipv4(port).await.unwrap()
    }
}

pub struct SyncPureFtpRunner {
    container: Container<AlpineFtpServer>,
}

impl SyncPureFtpRunner {
    pub fn start() -> Self {
        use testcontainers::runners::SyncRunner;
        let container = AlpineFtpServer::default()
            .start()
            .expect("Failed to start container");

        let resp = container
            .exec(
                ExecCommand::new(["/bin/mkdir", "-p", "/home/test/invalid-utf8"])
                    .with_cmd_ready_condition(CmdWaitFor::Exit { code: Some(0) }),
            )
            .expect("Failed to create directory");
        assert_eq!(
            resp.exit_code()
                .expect("failed to get exit code for mkdir")
                .expect("no exit code for mkdir"),
            0
        );
        let resp = container
            .exec(
                ExecCommand::new(["/bin/touch", "/home/test/invalid-utf8/caf\\303\\251.txt"])
                    .with_cmd_ready_condition(CmdWaitFor::Exit { code: Some(0) }),
            )
            .expect("Failed to create file");
        assert_eq!(
            resp.exit_code()
                .expect("failed to get exit code for touch")
                .expect("no exit code for touch"),
            0
        );

        Self { container }
    }

    pub fn get_ftp_port(&self) -> u16 {
        self.container.get_host_port_ipv4(21).unwrap()
    }

    pub fn get_mapped_port(&self, port: u16) -> u16 {
        self.container.get_host_port_ipv4(port).unwrap()
    }
}
