// Moved from src/i18n/locales/*/mobile.json's mobile.panelItems.metrics / mobile.metrics.* —
// values carried over verbatim, keys shortened now that this catalog is plugin-scoped.
export const messages: Record<"en"|"fr"|"ru"|"zh", Record<string,string>> = {
  en: {
    "title": "Metrics",
    "sshOnly": "Live metrics are only available for SSH sessions. Connect to a host over SSH to see its metrics.",
    "cpu": "CPU",
    "memory": "Memory",
    "netRx": "Net RX",
    "netTx": "Net TX",
  },
  fr: {
    "title": "Métriques",
    "sshOnly": "Les métriques en direct ne sont disponibles que pour les sessions SSH. Connectez-vous à un hôte en SSH pour voir ses métriques.",
    "cpu": "CPU",
    "memory": "Mémoire",
    "netRx": "Réseau RX",
    "netTx": "Réseau TX",
  },
  ru: {
    "title": "Метрики",
    "sshOnly": "Метрики в реальном времени доступны только для SSH-сессий. Подключитесь к хосту по SSH, чтобы увидеть его метрики.",
    "cpu": "CPU",
    "memory": "Память",
    "netRx": "Сеть RX",
    "netTx": "Сеть TX",
  },
  zh: {
    "title": "指标",
    "sshOnly": "实时指标仅适用于 SSH 会话。请通过 SSH 连接主机以查看其指标。",
    "cpu": "CPU",
    "memory": "内存",
    "netRx": "网络接收",
    "netTx": "网络发送",
  },
};
