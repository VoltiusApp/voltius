use super::exec::{now_ms, run_docker};
use crate::docker::recreate::{build_network_connects, build_run_args, parse_inspect};
use crate::docker::types::*;

/// The digest the image was pulled at locally (its registry `RepoDigest`), used
/// as the "current" side of an update check. `None` for locally-built images.
pub async fn local_image_digest(local_shell: Option<&str>, image: &str) -> Option<String> {
    match run_docker(
        local_shell,
        &[
            "image",
            "inspect",
            image,
            "--format",
            "{{json .RepoDigests}}",
        ],
    )
    .await
    {
        Ok(out) => serde_json::from_str::<Vec<String>>(out.trim())
            .ok()
            .and_then(|digests| pick_repo_digest(&digests, image)),
        Err(_) => None,
    }
}

/// Pull the latest image for a tag. Returns the CLI output.
pub async fn pull_image(local_shell: Option<&str>, image: &str) -> Result<String, String> {
    run_docker(local_shell, &["pull", image]).await
}

/// Recreate a single standalone container against the new `image` by
/// reconstructing its `docker run` invocation from `docker inspect`. The old
/// container is renamed to a backup and restored if the new `run` fails.
async fn recreate_standalone(
    local_shell: Option<&str>,
    image: &str,
    container_id: &str,
    name: &str,
) -> Result<(), String> {
    let inspect = run_docker(local_shell, &["inspect", container_id]).await?;
    let parsed = parse_inspect(&inspect)?;
    let run_args = build_run_args(&parsed, image);
    let connects = build_network_connects(&parsed, name);

    let backup = format!("{name}-old-{}", now_ms());

    let _ = run_docker(local_shell, &["stop", container_id]).await;
    run_docker(local_shell, &["rename", container_id, &backup])
        .await
        .map_err(|e| format!("rename failed: {e}"))?;

    let run_refs: Vec<&str> = run_args.iter().map(String::as_str).collect();
    match run_docker(local_shell, &run_refs).await {
        Ok(_) => {
            for cmd in &connects {
                let refs: Vec<&str> = cmd.iter().map(String::as_str).collect();
                let _ = run_docker(local_shell, &refs).await;
            }
            let _ = run_docker(local_shell, &["rm", "-f", &backup]).await;
            Ok(())
        }
        Err(e) => {
            // Roll back to the original container.
            let _ = run_docker(local_shell, &["rm", "-f", name]).await;
            let _ = run_docker(local_shell, &["rename", &backup, name]).await;
            let _ = run_docker(local_shell, &["start", name]).await;
            Err(format!("run failed (restored original): {e}"))
        }
    }
}

/// List running containers using `image`, with their compose identity. Must be
/// called *before* pulling — once the tag moves to the new image, an `ancestor`
/// filter no longer matches the still-running containers on the old image id.
async fn list_image_container_refs(
    local_shell: Option<&str>,
    image: &str,
) -> Result<Vec<ContainerComposeRef>, String> {
    let ancestor = format!("ancestor={image}");
    let output = run_docker(
        local_shell,
        &["ps", "--filter", &ancestor, "--format", RECREATE_PS_FORMAT],
    )
    .await?;
    Ok(output.lines().filter_map(parse_recreate_ps_line).collect())
}

/// Recreate the given containers against `image`. Compose-managed services are
/// recreated via `docker compose up -d`; standalone containers are rebuilt from
/// their inspected `docker run` config.
async fn recreate_refs(
    local_shell: Option<&str>,
    image: &str,
    refs: Vec<ContainerComposeRef>,
) -> RecreateResult {
    let mut result = RecreateResult::default();
    let mut seen = std::collections::HashSet::new();

    for ctr in refs {
        if !ctr.is_compose() {
            match recreate_standalone(local_shell, image, &ctr.id, &ctr.name).await {
                Ok(()) => result.recreated.push(ctr.name),
                Err(e) => {
                    result.manual.push(ctr.name.clone());
                    result.errors.push(format!("{}: {e}", ctr.name));
                }
            }
            continue;
        }
        let key = format!("{}/{}", ctr.project, ctr.service);
        if !seen.insert(key.clone()) {
            continue;
        }

        let mut args: Vec<String> = vec!["compose".into(), "--project-name".into(), ctr.project];
        for cf in &ctr.config_files {
            args.push("-f".into());
            args.push(cf.clone());
        }
        if !ctr.working_dir.is_empty() {
            args.push("--project-directory".into());
            args.push(ctr.working_dir);
        }
        args.extend(["up".into(), "-d".into(), "--no-deps".into(), ctr.service]);

        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        match run_docker(local_shell, &arg_refs).await {
            Ok(_) => result.recreated.push(key),
            Err(e) => result.errors.push(format!("{key}: {e}")),
        }
    }

    result
}

/// Recreate the containers currently using `image` (no pull). Standalone use.
pub async fn recreate_image_containers(
    local_shell: Option<&str>,
    image: &str,
) -> Result<RecreateResult, String> {
    let refs = list_image_container_refs(local_shell, image).await?;
    Ok(recreate_refs(local_shell, image, refs).await)
}

/// Resolve an image's content id (`docker image inspect --format {{.Id}}`),
/// used to detect whether a pull actually changed the image.
async fn image_id(local_shell: Option<&str>, image: &str) -> Option<String> {
    run_docker(
        local_shell,
        &["image", "inspect", image, "--format", "{{.Id}}"],
    )
    .await
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
}

/// Pull `image` and, when `recreate` is set and the pull actually fetched a new
/// image, recreate the containers that were using it. The target list is
/// captured *before* the pull so the tag move doesn't hide them from `ancestor`.
pub async fn pull_and_recreate(
    local_shell: Option<&str>,
    image: &str,
    recreate: bool,
) -> Result<RecreateResult, String> {
    let before = image_id(local_shell, image).await;
    let refs = if recreate {
        list_image_container_refs(local_shell, image)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let pull_output = pull_image(local_shell, image).await?;

    let after = image_id(local_shell, image).await;
    let image_updated = after.is_some() && before != after;

    let mut result = if recreate && image_updated {
        recreate_refs(local_shell, image, refs).await
    } else {
        RecreateResult::default()
    };
    result.image_updated = image_updated;
    if !image_updated {
        result.pull_output = tail_chars(&pull_output, 300);
    }
    Ok(result)
}
