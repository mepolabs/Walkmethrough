import { Order, OrderRepository } from "./repository";

export class OrderNotFound extends Error {}
export class InvalidOrderState extends Error {}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  async list(opts: { page: number; pageSize: number }): Promise<Page<Order>> {
    const offset = (opts.page - 1) * opts.pageSize;
    const [items, total] = await Promise.all([
      this.repo.findPage(offset, opts.pageSize),
      this.repo.count(),
    ]);
    return { items, page: opts.page, pageSize: opts.pageSize, total };
  }

  async cancel(id: string, reason?: string): Promise<Order> {
    const order = await this.repo.findById(id);
    if (!order) throw new OrderNotFound(`Order ${id} not found`);
    if (order.status !== "pending") {
      throw new InvalidOrderState(`Only pending orders can be cancelled (was ${order.status})`);
    }
    return this.repo.updateStatus(id, "cancelled", reason ?? null);
  }
}
