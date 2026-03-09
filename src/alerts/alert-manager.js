export class AlertManager {
  constructor(channels = []) {
    this.channels = channels;
  }

  async send(alert) {
    for (const channel of this.channels) {
      await channel.send(alert);
    }
  }
}
