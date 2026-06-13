export default function MobileDockerLogsScreen({ sessionId, containerId, containerName }: { sessionId: string; containerId: string; containerName: string }) {
  return <div data-stub-docker-logs={sessionId} data-container-id={containerId} data-container-name={containerName} />;
}
