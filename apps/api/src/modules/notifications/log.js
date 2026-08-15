export function createLogNotifier(env, log, prisma) {
  return {
    async sendText({ to, text, event, orderId }) {
      log?.info({ to, event, text, provider: 'log' }, 'LogNotifier: sendText');
      await prisma.notification.create({
        data: {
          to,
          text,
          event,
          orderId,
          provider: 'log',
          status: 'sent',
          attempts: 1,
          sentAt: new Date(),
          providerResponse: { mocked: true }
        }
      });
      return true;
    }
  };
}
