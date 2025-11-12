import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listUserPositions, setUserPositionHidden } from '../db';
import { asBooleanFlag } from '../utils/flags';

const PositionsQueryDto = z.object({
  user_id: z.coerce.number().int().nonnegative(),
  include_hidden: z.coerce.number().int().optional(),
});

const PositionHideDto = z.object({
  user_id: z.coerce.number().int().nonnegative(),
  hidden: z.boolean().optional(),
});

export function registerPositionRoutes(app: FastifyInstance) {
  app.get('/positions', async (req, reply) => {
    try {
      const query = PositionsQueryDto.parse((req.query ?? {}) as any);
      const includeHidden = asBooleanFlag(query.include_hidden);
      const positions = await listUserPositions(query.user_id, { includeHidden });
      return reply.send(positions);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /positions error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.post('/positions/:id/hide', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id_required' });
      const payload = PositionHideDto.parse((req.body ?? {}) as any);
      const updated = await setUserPositionHidden(
        payload.user_id,
        id,
        payload.hidden ?? true
      );
      if (!updated) return reply.code(404).send({ error: 'not_found' });
      return reply.send(updated);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'POST /positions/:id/hide error');
      return reply.code(500).send({ error: 'internal' });
    }
  });
}
