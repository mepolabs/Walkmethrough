import { Pool } from "pg";

export type OrderStatus = "pending" | "paid" | "shipped" | "cancelled";

export interface Order {
  id: string;
  status: OrderStatus;
  cancelReason: string | null;
  createdAt: Date;
}

export class OrderRepository {
  constructor(private readonly db: Pool) {}

  async findById(id: string): Promise<Order | null> {
    const { rows } = await this.db.query("SELECT * FROM orders WHERE id = $1", [id]);
    return rows[0] ? toOrder(rows[0]) : null;
  }

  async findPage(offset: number, limit: number): Promise<Order[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM orders ORDER BY created_at DESC, id OFFSET $1 LIMIT $2",
      [offset, limit],
    );
    return rows.map(toOrder);
  }

  async count(): Promise<number> {
    const { rows } = await this.db.query("SELECT count(*)::int AS n FROM orders");
    return rows[0].n;
  }

  async updateStatus(id: string, status: OrderStatus, reason: string | null): Promise<Order> {
    const { rows } = await this.db.query(
      "UPDATE orders SET status = $2, cancel_reason = $3 WHERE id = $1 RETURNING *",
      [id, status, reason],
    );
    return toOrder(rows[0]);
  }
}

function toOrder(row: any): Order {
  return {
    id: row.id,
    status: row.status,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
  };
}
