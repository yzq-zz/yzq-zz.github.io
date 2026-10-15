# 数据库防止死锁 / 超卖：原子 UPDATE + 影响行数

## 一句话总结

把"判断库存是否足够"和"扣减库存"合并成**一条带条件 `WHERE stock > 0` 的原子 `UPDATE`**，执行后检查 `affected_rows`：

- `= 1`：抢到，继续创建订单；
- `= 0`：售罄，回滚或返回失败。

```sql
BEGIN;

UPDATE product
SET stock = stock - 1
WHERE id = 1 AND stock > 0;

-- affected_rows = 1 才继续
INSERT INTO orders(...);

COMMIT;
```

---

## 一、为什么这样能防超卖

假设 `stock = 1`，两个用户并发执行同一条 SQL：

```sql
UPDATE product SET stock = stock - 1 WHERE id = 1 AND stock > 0;
```

- T1 先拿到这一行的排他锁，执行成功，`stock` 变 0，`affected_rows = 1`。
- T2 想更新同一行，被 T1 的行锁挡住，等待。
- T1 提交后，T2 重新读取最新数据，发现 `stock = 0`，`WHERE stock > 0` 不满足，`affected_rows = 0`。
- 最终只有 T1 成功，不会超卖。

---

## 二、关键概念：当前读

- **普通 `SELECT`**：快照读，可能读到旧版本的数据，**不能**用于并发扣减判断。
- **`UPDATE ... WHERE ...`**：**当前读**，读最新已提交版本，并对命中的行加排他锁（行锁）。
- 因此防超卖靠的不是"先 SELECT 再 UPDATE"，而是 `UPDATE` **自身**完成"读最新值 + 判断条件 + 加行锁 + 修改"四件事。

---

## 三、另一种写法：悲观锁 `SELECT ... FOR UPDATE`

```sql
BEGIN;

SELECT stock FROM product WHERE id = 1 FOR UPDATE;
-- 应用层判断 stock > 0
UPDATE product SET stock = stock - 1 WHERE id = 1;

INSERT INTO orders(...);
COMMIT;
```

`SELECT ... FOR UPDATE` 也是当前读并加行锁。但相比"单条条件 `UPDATE`"：

- 多了一次往返；
- 判断逻辑落到应用层；
- 通常**不如 `UPDATE ... WHERE stock > 0` 简洁高效**。

---

## 四、关键点

- **事务本身不防超卖**，它只保证原子性。
- **真正防超卖的是「行锁 + 条件判断」**。
- **最推荐**：`UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock > 0`，再根据影响行数判断。
- **扣库存和创建订单必须放在同一个事务里**，否则两步之间出问题会数据不一致。
- **若扣库存成功但订单插入失败，要 `ROLLBACK`** 把库存还回去。
- 如果担心热点行单条 `UPDATE` 串行化成为瓶颈，再叠加 Redis 预扣 / 令牌桶等方案做削峰，而不是放弃这条原子 `UPDATE`。
