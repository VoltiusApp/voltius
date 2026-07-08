use std::time::{Duration, SystemTime, UNIX_EPOCH};

//===========================================================================//

/// The CFB timestamp value for the Unix epoch (Jan 1, 1970 UTC).
const UNIX_EPOCH_TIMESTAMP: u64 = 116444736000000000;

/// Returns the current time as a CFB file timestamp (the number of
/// 100-nanosecond intervals since January 1, 1601 UTC).
pub fn current_timestamp() -> u64 {
    timestamp_from_system_time(SystemTime::now())
}

/// Converts a local `SystemTime` to a CFB file timestamp.
fn timestamp_from_system_time(system_time: SystemTime) -> u64 {
    match system_time.duration_since(UNIX_EPOCH) {
        Ok(duration) => {
            let delta = duration_to_timestamp_delta(duration);
            UNIX_EPOCH_TIMESTAMP.saturating_add(delta)
        }
        Err(err) => {
            let delta = duration_to_timestamp_delta(err.duration());
            UNIX_EPOCH_TIMESTAMP.saturating_sub(delta)
        }
    }
}

/// Converts a CFB file timestamp to a local `SystemTime`.
pub fn system_time_from_timestamp(timestamp: u64) -> SystemTime {
    // The maximum range of SystemTime varies by system, and some systems
    // (e.g. 32-bit Linux) can't represent, say, a zero CFB timestamp.  So we
    // center our calculations around UNIX_EPOCH (the one value we can be sure
    // that SystemTime can represent), and use checked_add and checked_sub to
    // avoid panicking on overflow.
    //
    // TODO: If SystemTime ever gains saturating_add and saturing_sub (see
    // https://github.com/rust-lang/rust/issues/71224) we should use those
    // instead.
    let system_time = if timestamp >= UNIX_EPOCH_TIMESTAMP {
        UNIX_EPOCH.checked_add(timestamp_delta_to_duration(
            timestamp - UNIX_EPOCH_TIMESTAMP,
        ))
    } else {
        UNIX_EPOCH.checked_sub(timestamp_delta_to_duration(
            UNIX_EPOCH_TIMESTAMP - timestamp,
        ))
    };
    // If overflow does occur, just return UNIX_EPOCH; this will be totally
    // wrong, but at least it will allow us to continue reading the CFB file
    // without panicking.
    system_time.unwrap_or(UNIX_EPOCH)
}

fn duration_to_timestamp_delta(duration: Duration) -> u64 {
    duration
        .as_secs()
        .saturating_mul(10_000_000)
        .saturating_add((duration.subsec_nanos() / 100) as u64)
}

fn timestamp_delta_to_duration(delta: u64) -> Duration {
    Duration::new(delta / 10_000_000, (delta % 10_000_000) as u32 * 100)
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::{
        duration_to_timestamp_delta, system_time_from_timestamp,
        timestamp_delta_to_duration, timestamp_from_system_time,
        UNIX_EPOCH_TIMESTAMP,
    };
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn extreme_timestamp_delta() {
        // The maximum representable CFB timestamp:
        let timestamp = u64::MAX;
        let duration = timestamp_delta_to_duration(timestamp);
        assert_eq!(duration.as_secs(), 1844674407370);
        assert_eq!(duration.subsec_nanos(), 955161500);
        assert_eq!(duration_to_timestamp_delta(duration), timestamp);
    }

    #[test]
    fn extreme_duration() {
        // The maximum representable duration:
        let duration = Duration::new(u64::MAX, 999_999_999);
        // This duration will not fit in a 64-bit CFB timestamp delta.  Rather
        // than overflow, we should return a saturated result.
        assert_eq!(duration_to_timestamp_delta(duration), u64::MAX);
    }

    #[test]
    fn unix_epoch() {
        assert_eq!(
            UNIX_EPOCH_TIMESTAMP,
            timestamp_from_system_time(UNIX_EPOCH)
        );
        assert_eq!(
            system_time_from_timestamp(UNIX_EPOCH_TIMESTAMP),
            UNIX_EPOCH
        );
    }

    #[test]
    fn after_unix_epoch() {
        let sat_18_mar_2017_at_18_46_36_utc =
            UNIX_EPOCH + Duration::from_secs(1489862796);
        assert_eq!(
            timestamp_from_system_time(sat_18_mar_2017_at_18_46_36_utc),
            131343363960000000,
        );
        assert_eq!(
            system_time_from_timestamp(131343363960000000),
            sat_18_mar_2017_at_18_46_36_utc
        );
    }

    #[test]
    fn before_unix_epoch() {
        let sun_20_jul_1969_at_20_17_00_utc =
            UNIX_EPOCH - Duration::from_secs(14182980);
        assert_eq!(
            timestamp_from_system_time(sun_20_jul_1969_at_20_17_00_utc),
            116302906200000000,
        );
        assert_eq!(
            system_time_from_timestamp(116302906200000000),
            sun_20_jul_1969_at_20_17_00_utc
        );
    }

    #[test]
    fn extreme_timestamps() {
        // If the system we're on can't represent these timestamps in a
        // SystemTime, then we'll get incorrect values, but we shouldn't panic.
        let min_time = system_time_from_timestamp(u64::MIN);
        let max_time = system_time_from_timestamp(u64::MAX);
        assert!(min_time <= max_time);
    }
}

//===========================================================================//
