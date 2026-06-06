use super::exec::{connect, run_compose, run_wsl_docker, should_use_wsl_cli};
use crate::docker::cli::{self, CliContainer, CliImage, CliNetwork, CliVolume};
use crate::docker::types::*;
use bollard::models::PortSummaryTypeEnum;
use bollard::query_parameters::{
    ListContainersOptionsBuilder, ListImagesOptionsBuilder, ListVolumesOptions,
};

async fn list_containers_cli(
    local_shell: Option<&str>,
    all: bool,
) -> Result<Vec<DockerContainer>, String> {
    let mut args = vec!["ps"];
    if all {
        args.push("-a");
    }
    args.extend(["--format", cli::JSON_LINE_FORMAT]);
    let output = run_wsl_docker(local_shell, &args).await?;

    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<CliContainer>(line)
                .map(CliContainer::into_domain)
                .map_err(|e| format!("Failed to parse docker ps output: {e}"))
        })
        .collect()
}

pub async fn list_containers(
    local_shell: Option<&str>,
    all: bool,
) -> Result<Vec<DockerContainer>, String> {
    if should_use_wsl_cli(local_shell) {
        return list_containers_cli(local_shell, all).await;
    }

    let docker = connect()?;
    let containers = docker
        .list_containers(Some(ListContainersOptionsBuilder::new().all(all).build()))
        .await
        .map_err(|e| format!("{e}"))?;

    Ok(containers
        .into_iter()
        .map(|c| {
            let ports = c
                .ports
                .unwrap_or_default()
                .into_iter()
                .map(|p| PortMapping {
                    host_ip: p.ip,
                    host_port: p.public_port,
                    container_port: p.private_port,
                    protocol: p
                        .typ
                        .map(|t| match t {
                            PortSummaryTypeEnum::TCP => "tcp",
                            PortSummaryTypeEnum::UDP => "udp",
                            PortSummaryTypeEnum::SCTP => "sctp",
                            _ => "tcp",
                        })
                        .unwrap_or("tcp")
                        .to_string(),
                })
                .collect();

            DockerContainer {
                id: c.id.unwrap_or_default(),
                names: c.names.unwrap_or_default(),
                image: c.image.unwrap_or_default(),
                status: c.status.unwrap_or_default(),
                state: c.state.map(|s| s.to_string()).unwrap_or_default(),
                ports,
                created: c.created.unwrap_or(0),
            }
        })
        .collect())
}

pub async fn list_images(local_shell: Option<&str>) -> Result<Vec<DockerImage>, String> {
    if should_use_wsl_cli(local_shell) {
        let output =
            run_wsl_docker(local_shell, &["images", "--format", cli::JSON_LINE_FORMAT]).await?;
        return output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str::<CliImage>(line)
                    .map(CliImage::into_domain)
                    .map_err(|e| format!("Failed to parse docker images output: {e}"))
            })
            .collect();
    }

    let docker = connect()?;
    let images = docker
        .list_images(Some(ListImagesOptionsBuilder::new().all(false).build()))
        .await
        .map_err(|e| format!("{e}"))?;

    Ok(images
        .into_iter()
        .map(|i| DockerImage {
            id: i.id,
            repo_tags: i.repo_tags,
            size: i.size,
            created: i.created,
        })
        .collect())
}

pub async fn list_volumes(local_shell: Option<&str>) -> Result<Vec<DockerVolume>, String> {
    if should_use_wsl_cli(local_shell) {
        let output = run_wsl_docker(
            local_shell,
            &["volume", "ls", "--format", cli::JSON_LINE_FORMAT],
        )
        .await?;
        return output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str::<CliVolume>(line)
                    .map(CliVolume::into_domain)
                    .map_err(|e| format!("Failed to parse docker volume output: {e}"))
            })
            .collect();
    }

    let docker = connect()?;
    let resp = docker
        .list_volumes(Option::<ListVolumesOptions>::None)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(resp
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(|v| DockerVolume {
            name: v.name,
            driver: v.driver,
        })
        .collect())
}

pub async fn list_networks(local_shell: Option<&str>) -> Result<Vec<DockerNetwork>, String> {
    if should_use_wsl_cli(local_shell) {
        let output = run_wsl_docker(
            local_shell,
            &["network", "ls", "--format", cli::JSON_LINE_FORMAT],
        )
        .await?;
        return output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str::<CliNetwork>(line)
                    .map(CliNetwork::into_domain)
                    .map_err(|e| format!("Failed to parse docker network output: {e}"))
            })
            .collect();
    }

    let docker = connect()?;
    let networks = docker
        .list_networks(None)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(networks
        .into_iter()
        .map(|n| DockerNetwork {
            id: n.id.unwrap_or_default(),
            name: n.name.unwrap_or_default(),
            driver: n.driver.unwrap_or_default(),
        })
        .collect())
}

pub async fn list_stacks(local_shell: Option<&str>) -> Result<Vec<DockerStack>, String> {
    let output = run_compose(local_shell, &["ls", "--all", "--format", "json"]).await?;
    parse_compose_stacks(&output)
}

pub async fn list_stack_services(
    local_shell: Option<&str>,
    stack_name: &str,
) -> Result<Vec<DockerStackService>, String> {
    let output = run_compose(
        local_shell,
        &["-p", stack_name, "ps", "--all", "--format", "json"],
    )
    .await?;
    parse_compose_services(&output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_compose_stack_list_json_array() {
        let output = r#"[
          {"Name":"demo","Status":"running(2)","ConfigFiles":"/tmp/docker-compose.yml"},
          {"Name":"stopped","Status":"exited(1), running(1)","ConfigFiles":"/tmp/compose.yml,/tmp/override.yml"}
        ]"#;

        let stacks = parse_compose_stacks(output).expect("stacks parse");

        assert_eq!(stacks.len(), 2);
        assert_eq!(stacks[0].name, "demo");
        assert_eq!(stacks[0].running, 2);
        assert_eq!(stacks[0].total, 2);
        assert_eq!(stacks[0].config_files, vec!["/tmp/docker-compose.yml"]);
        assert_eq!(stacks[1].running, 1);
        assert_eq!(stacks[1].exited, 1);
        assert_eq!(stacks[1].total, 2);
        assert_eq!(
            stacks[1].config_files,
            vec!["/tmp/compose.yml", "/tmp/override.yml"]
        );
    }

    #[test]
    fn parses_compose_service_ps_json_lines() {
        let output = r#"{"ID":"abc123","Name":"demo-web-1","Project":"demo","Service":"web","Image":"nginx:latest","State":"running","Status":"Up 2 minutes","Publishers":[{"URL":"0.0.0.0","TargetPort":80,"PublishedPort":8080,"Protocol":"tcp"}]}
{"ID":"def456","Name":"demo-db-1","Project":"demo","Service":"db","Image":"postgres:16","State":"exited","Status":"Exited (0)"}"#;

        let services = parse_compose_services(output).expect("services parse");

        assert_eq!(services.len(), 2);
        assert_eq!(services[0].service, "web");
        assert_eq!(services[0].ports.len(), 1);
        assert_eq!(services[0].ports[0].host_port, Some(8080));
        assert_eq!(services[0].ports[0].container_port, 80);
        assert_eq!(services[1].state, "exited");
    }
}
