# 单例模式

保证一个类在整个 JVM 中只有一个实例，并提供一个全局访问点。

> 每段代码都可以点「默写模式」自己默写一遍检验记忆：写一半忘了可以随时切回「查看答案」，草稿自动保留在浏览器本地。

## 前置：public/private 和 static 是两个独立维度

| 修饰 | 管什么 | 含义 |
| --- | --- | --- |
| `public` / `private` | **谁能碰**（权限） | public 谁都能用；private 只有本类内部能用 |
| `static` | **属于谁**（归属） | 不加 static 属于**对象**，必须先有对象才能用；加了属于**类**，类名直接访问 |

两个推论：

- **getInstance 必须 static**：构造方法私有 → 外部没法 new → 入口必须是类级别的。否则调用 getInstance 也要先有对象，"为了拿对象先要对象"，死循环。
- **INSTANCE 必须 static**：static 方法里没有"当前对象"，只够得着 static 成员，够不着实例字段。

## 单例三件套（所有写法的骨架）

1. 构造方法 `private` —— 关掉 new 这扇门
2. 实例字段 `private static` —— 全类唯一的存储位置，外部改不了
3. 获取方法 `public static` —— 唯一对外开放的取货口

## 一、饿汉式

<RecallCode name="singleton-hungry">

```java
public class LazySingleton {
    // 饿汉式：类加载时直接 new，不懒
    private static final LazySingleton INSTANCE = new LazySingleton();
    private LazySingleton() {}
    public static LazySingleton getInstance() {
        return INSTANCE;
    }
}
```

</RecallCode>

- 类一加载就创建实例，天生线程安全（靠 JVM 类加载机制）
- 缺点：不管用不用，加载类就创建，可能浪费资源
- `final` 在声明处当场赋值，锁死"引用永远不变"

## 二、DCL 双重检查锁（懒汉式）

<RecallCode name="singleton-dcl">

```java
public class DCLSingleton {
    // volatile 防止 new 的三步发生重排序
    private static volatile DCLSingleton INSTANCE;
    private DCLSingleton() {}
    public static DCLSingleton getInstance() {
        if (INSTANCE == null) {                 // 第一次检查：实例已存在就不用抢锁
            synchronized (DCLSingleton.class) {
                if (INSTANCE == null) {         // 第二次检查：排队进来后可能别人已经创建过
                    INSTANCE = new DCLSingleton();
                }
            }
        }
        return INSTANCE;
    }
}
```

</RecallCode>

**为什么要 volatile？** `new` 一个对象分三步：分配内存 → 初始化对象 → 引用指向内存。这三步可能发生指令重排序。没有 volatile 时，线程 A 执行到"引用已指向、对象还没初始化完"，线程 B 第一次检查发现不为 null，直接返回一个**半成品对象**。

**为什么不能加 final？** final 字段必须在**声明的那一刻当场赋值**，不能先空着以后在方法里赋值。DCL 的本质就是"延迟到第一次调用才赋值"，没资格用 final。

::: danger 常见踩坑
锁内二次检查通过后，要先 `INSTANCE = new ...()` 赋值、再返回。如果直接 `return new ...()` 而不赋值，INSTANCE 永远是 null，每次调用都创建新对象——根本不是单例。
:::

## 三、静态内部类 Holder（懒汉式，推荐）

<RecallCode name="singleton-holder">

```java
public class NeedSingleton {
    private NeedSingleton() {}
    public static NeedSingleton getInstance() {
        return Hold.INSTANCE;
    }

    private static class Hold {
        private static final NeedSingleton INSTANCE = new NeedSingleton();
    }
}
```

</RecallCode>

**懒加载原理**：不是"调用 getInstance 才 new"，而是**第一次用到 Hold 这个类时**，JVM 才加载它、才执行那行 new。getInstance 只是第一次引用 Hold 的地方。

**线程安全原理**：类加载只发生一次，且 JVM 的类初始化锁天然保证线程安全。`static final` 声明处初始化还保证了对象对所有线程**安全发布**（不会看到半成品）。

**为什么是实际工作中的首选**：既懒加载又线程安全，代码最干净——DCL 里那一堆 volatile、synchronized、双重判断，JVM 类加载机制全替你做了。

## 三种写法对比

| 写法 | 懒加载 | 线程安全手段 | 备注 |
| --- | --- | --- | --- |
| 饿汉式 | ❌ 类加载即创建 | JVM 类加载机制 | 简单，可能浪费资源 |
| DCL | ✅ | volatile + synchronized + 双重检查 | 面试高频，考察点最多 |
| Holder | ✅ | JVM 类加载机制（免费） | **实际工作首选**，等价于 DCL 的效果但更优雅 |

> 延伸：《Effective Java》还推荐**枚举**单例——天然防反射、防反序列化破坏单例，是最安全的方式。

## 踩坑记录

- 构造方法写成 `public` → 大门敞开谁都能 new，就不叫单例了
- getInstance 忘写 `static` → 死循环，永远拿不到对象
- DCL 锁内忘记赋值给 INSTANCE → 每次返回新对象
- 内部类声明成非静态（少写 `static`）→ 非静态内部类不允许有 static 成员，直接编译报错
- `INSTANCE` 拼写错误 → 编译器报"找不到符号"，注意 INSTANCE / INSTACNE
