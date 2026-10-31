use std::collections::VecDeque;

/// Ids in arrival order; past `CAP` the oldest is dropped.
#[derive(Default)]
pub struct RecentIds<const CAP: usize>(VecDeque<String>);

impl<const CAP: usize> RecentIds<CAP> {
    pub fn insert(&mut self, id: &str) {
        if self.contains(id) {
            return;
        }
        if self.0.len() >= CAP {
            self.0.pop_front();
        }
        self.0.push_back(id.to_string());
    }

    pub fn contains(&self, id: &str) -> bool {
        self.0.iter().any(|x| x == id)
    }

    pub fn take(&mut self, id: &str) -> bool {
        match self.0.iter().position(|x| x == id) {
            Some(i) => self.0.remove(i).is_some(),
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RecentIds;

    #[test]
    fn the_oldest_drops_past_the_cap() {
        let mut ids = RecentIds::<2>::default();
        ids.insert("a");
        ids.insert("b");
        ids.insert("c");
        assert!(!ids.contains("a"));
        assert!(ids.contains("b") && ids.contains("c"));
    }

    #[test]
    fn a_repeat_does_not_push_others_out() {
        let mut ids = RecentIds::<2>::default();
        ids.insert("a");
        ids.insert("b");
        ids.insert("b");
        assert!(ids.contains("a"));
    }

    #[test]
    fn take_removes_once() {
        let mut ids = RecentIds::<2>::default();
        ids.insert("a");
        assert!(ids.take("a"));
        assert!(!ids.take("a"));
        assert!(!ids.contains("a"));
    }
}
