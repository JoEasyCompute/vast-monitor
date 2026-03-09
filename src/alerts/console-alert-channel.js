export class ConsoleAlertChannel {
  async send(alert) {
    const machineText = alert.hostname ? ` [${alert.hostname}]` : "";
    console.log(`[alert:${alert.severity}]${machineText} ${alert.message}`);
  }
}
