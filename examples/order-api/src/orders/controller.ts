import { Router, Request, Response } from "express";
import { OrderService, OrderNotFound, InvalidOrderState } from "./service";

export function orderRoutes(service: OrderService): Router {
  const router = Router();

  router.get("/orders", async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
    const result = await service.list({ page, pageSize });
    res.json(result);
  });

  router.post("/orders/:id/cancel", async (req: Request, res: Response) => {
    try {
      const order = await service.cancel(req.params.id, req.body?.reason);
      res.json(order);
    } catch (err) {
      if (err instanceof OrderNotFound) return res.status(404).json({ error: err.message });
      if (err instanceof InvalidOrderState) return res.status(409).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
