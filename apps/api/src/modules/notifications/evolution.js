// usa o fetch global do Node ≥18 (node-fetch não é dependência do projeto)

export function createEvolutionNotifier(env, log, prisma) {
  const url = env.EVOLUTION_URL;
  const instance = env.EVOLUTION_INSTANCE;
  const apikey = env.EVOLUTION_APIKEY;

  return {
    async sendText({ to, text, event, orderId }) {
      let status = 'pending';
      let lastError = null;
      let providerResponse = null;

      const notif = await prisma.notification.create({
        data: { to, text, event, orderId, provider: 'evolution', status, attempts: 0 }
      });

      // Fire and forget, don't block
      (async () => {
        let attempt = 0;
        let success = false;

        while (attempt < 3 && !success) {
          attempt++;
          try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(`${url}/message/sendText/${instance}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey
              },
              body: JSON.stringify({ number: to, text }),
              signal: controller.signal
            });
            clearTimeout(id);

            providerResponse = await res.json();
            
            if (res.ok) {
              success = true;
              status = 'sent';
            } else {
              lastError = `Status ${res.status}: ${JSON.stringify(providerResponse)}`;
            }
          } catch (err) {
            lastError = err.message;
          }

          if (!success && attempt < 3) {
            await new Promise(r => setTimeout(r, 2000 * attempt)); // Backoff
          }
        }

        if (!success) {
          status = 'failed';
          log?.error({ to, event, lastError, provider: 'evolution' }, 'EvolutionNotifier failed to send text');
        } else {
          log?.info({ to, event, provider: 'evolution' }, 'EvolutionNotifier sent text');
        }

        await prisma.notification.update({
          where: { id: notif.id },
          data: {
            status,
            attempts: attempt,
            lastError,
            providerResponse: providerResponse || {},
            sentAt: success ? new Date() : null
          }
        });

      })().catch(err => log?.error({ err: err.message }, 'EvolutionNotifier background task error'));

      return true;
    }
  };
}
