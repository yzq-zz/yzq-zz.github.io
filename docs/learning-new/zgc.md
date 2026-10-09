# ZGC 详解

一句话：JDK 11 引入的低延迟垃圾回收器，STW 停顿不超过 1ms，且**与堆大小无关**。怎么做到的？

> 核心思路：把"重活"全部并发做，只在 STW 时做 GC Roots 的快速处理。代价是每次读指针多一次颜色位判断（纳秒级），远小于秒级 STW。

## 先说最大的误解

我一开始以为"只有被搬走的对象指针才需要变成 Remapped"，这是错的。

**正确理解：good_color 是全局的。STW3 后全局 good_color 从 M0 切成 Remapped，所有指针（不管指向的对象搬没搬）最终都要变成 Remapped。区别只在于：搬走的对象地址变新，没搬的对象地址不变。**

## 染色指针

64 位指针的低几位存 GC 元数据。x86-64 实际只用 48 位寻址，ZGC 借走高几位存状态，硬件直接支持：

| 颜色 | 含义 |
| --- | --- |
| `M0` / `M1` | 本轮标记色，交替使用区分轮次 |
| `Remapped` | 指针已对齐当前视图，地址有效 |

好处：barrier 只看指针一眼就知道要不要处理，**不查对象头，不加锁**。

## good_color 全局切换

这是最核心的概念。

`good_color` 是**一个全局变量**。每次 STW 切换它，所有指针瞬间"wrong"，但指针本身一个都没动。

```
good_color 旋转: M0 → Rm → M1 → Rm → ...
```

切换 = O(1) 写，**不动堆里任何一个指针**。错误颜色靠 barrier 逐槽修正，GC 并发做。

## Load Barrier 怎么工作

每次 Java 读引用字段都触发 barrier：

```
ref = *fieldAddr
if (colorBits(ref) ≠ good_color) {
    ref = slow_path(fieldAddr, ref)
}
use(ref)
```

fast path 只比较颜色位，寄存器操作，几纳秒。slow path 才走并发路径。

## slow_path 到底干了什么

```
slow_path(ptr):
    old = ptr 去色
    if forwarding[old] 找到:    // 对象被搬走了
        addr = 新地址
    else:                       // 对象没搬走
        addr = 原地址
    return addr | 当前 good_color
```

- 搬走的：地址变 + 颜色变
- 没搬的：地址不变 + 颜色变
- **共同结果：颜色都变成 good_color**

这就是为什么说"只有被搬对象才 Remapped"是误解——good_color 切到 Remapped 后，**所有 M0 指针都是 wrong**，都要逐槽修。

## SATB 写屏障

并发标记开始时照一张快照。之后应用线程写屏障记录"曾经指向谁"，保证标记不漏。

代价：可能多活几个垃圾（下轮回收）。好处：不需要反复扫描保证正确性。

## 一轮 GC 的 8 个阶段

| 阶段 | 类型 | good_color | 干了什么 |
| --- | --- | --- | --- |
| 初始 | 稳态 | Remapped | 所有指针 Remapped，barrier 休眠 |
| STW1 | STW | `Remapped → M0` | 从 GC Roots 标记直接可达对象 |
| 并发标记 | 并发 | M0 | 遍历对象图，SATB 保证快照一致 |
| STW2 | STW | M0（不变） | 排空 SATB、选 Relocation Set |
| STW3 | STW | `M0 → Remapped` | 复制 Roots 引用的对象，更新根指针 |
| 并发转移 | 并发 | Remapped | GC 继续复制，barrier 惰性修复堆内旧指针 |
| Barrier命中 | 触发 | Remapped | 应用线程读旧指针 → slow_path → 修复 |
| 完成 | 稳态 | Remapped | 所有被读的指针已对齐 |

**为什么只有这 3 个 STW：**
- STW1：冻结应用线程，保证 GC Roots 快照干净
- STW2：排空缓冲、处理 Soft/Weak 引用，并发处理会有竞争
- STW3：GC Roots 直接引用的对象被复制后，根指针必须立即更新，否则应用线程可能读到旧地址

## 为什么 ZGC 快

**核心：STW 只处理 GC Roots，跟堆大小、活对象数量无关。**

| 传统 GC | ZGC |
| --- | --- |
| Full GC 停 1-2 秒（扫所有活对象） | 只有 3 个 STW，只处理 GC Roots |
| 并发要加锁 | 读指针不加锁，颜色位判断是寄存器操作 |
| 对象头额外空间 | 染色指针只占几位 |
| 全堆整理 | 只搬有垃圾的 Region，选择性转移 |

## 可视化演示

[点此打开 ZGC 交互演示（独立页面）](/zgc.html)
