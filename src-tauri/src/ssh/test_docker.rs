use std::process::{Command, Output};

pub fn docker(args: &[&str]) -> Output {
    Command::new("docker")
        .args(args)
        .output()
        .expect("docker runs")
}

/// A container this test started; removed by its exact name when dropped.
pub struct Container(pub String);

impl Container {
    pub fn run(name: String, args: &[&str]) -> Self {
        docker(&["rm", "-f", &name]);
        let mut run = vec!["run", "-d", "--name", &name];
        run.extend_from_slice(args);
        let out = docker(&run);
        assert!(
            out.status.success(),
            "docker run {name}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        Self(name)
    }
}

impl Drop for Container {
    fn drop(&mut self) {
        docker(&["rm", "-f", &self.0]);
    }
}
