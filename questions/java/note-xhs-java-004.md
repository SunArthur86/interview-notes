---
id: note-xhs-java-004
difficulty: L4
category: java
subcategory: Spring
tags:
- Spring
- IOC
- AOP
- 依赖注入
- 动态代理
feynman:
  essence: IOC是「别人帮你创建对象」，AOP是「不改动原代码就能加功能」。依赖注入就是容器主动把依赖塞给你，而不是你自己去new。
  analogy: "IOC像住酒店不用自己打扫（服务员=容器帮你搞定）；AOP像给所有方法都装了监控摄像头（不用改每个方法，统一拦截）。三级缓存解决循环依赖就像：A和B互相等对方（循环依赖），酒店先给A一个临时房卡（半成品），等B办好了再换正式卡。"
  key_points:
  - IOC=对象创建权交给容器，DI=容器自动注入依赖
  - 构造器注入最推荐（可final、不可变、强制依赖）
  - 三级缓存解决singleton循环依赖+AOP代理问题
  - AOP默认JDK代理(有接口)/CGLIB(无接口)
  - 内部方法调用绕过代理→AOP失效，需注入自身代理
first_principle:
  problem: "软件系统中对象之间的依赖关系管理复杂，且横切关注点（日志/事务/权限）散布在各业务方法中。如何解耦对象创建和功能增强？"
  axioms:
  - 控制反转：对象不应自己创建依赖，应由容器统一管理
  - 单一职责：业务逻辑不应混入日志/事务等横切关注点
  - 动态代理：运行时生成代理对象可以在不修改源码的前提下增强功能
  - 提前暴露：循环依赖可通过暴露半成品引用来解决
  rebuild: "从对象依赖管理出发：工厂模式→IOC容器(统一管理)→DI(自动注入)→三级缓存(解决循环依赖)→AOP(代理增强)→AOP失效场景(内部调用绕过代理)"
follow_up:
- Spring 三级缓存为什么不能是两级缓存？
- '@Autowired 和 @Resource 的区别？'
- Spring AOP 和 AspectJ 的区别？
- Bean 的作用域有哪些？prototype 的循环依赖能解决吗？
---

# Spring IOC、AOP 原理及依赖注入实现方式？（华为od Java一面）

## 一、IOC（控制反转）

### 本质：对象创建权从代码转移到容器

```
传统方式（正向控制）：               IOC方式（控制反转）：
┌─────────────┐                   ┌──────────────┐
│ class User { │                   │ @Component    │
│   Dao dao =  │                   │ class User {  │
│   new Dao(); │  ← 自己new         │   @Autowired  │
│ }            │                   │   Dao dao;    │ ← 容器注入
└─────────────┘                   │ }             │
                                  └──────────────┘
                                    Spring Container
```

### Bean 生命周期（核心12步）

```
1. 实例化 (instantiateBean)
      ↓
2. 属性填充 (populateBean) ← @Autowired/@Value 注入
      ↓
3. Aware回调 (BeanNameAware/BeanFactoryAware)
      ↓
4. BeanPostProcessor.postProcessBeforeInitialization
      ↓
5. @PostConstruct
      ↓
6. InitializingBean.afterPropertiesSet()
      ↓
7. 自定义 init-method
      ↓
8. BeanPostProcessor.postProcessAfterInitialization  ← AOP代理在这里创建
      ↓
9. Bean 就绪，放入单例池
      ↓
10. 容器关闭 → @PreDestroy
      ↓
11. DisposableBean.destroy()
      ↓
12. 自定义 destroy-method
```

## 二、依赖注入（DI）实现方式

### 三种注入方式

```java
// 1. 字段注入（不推荐，无法final）
@Autowired
private UserDao userDao;

// 2. Setter注入（可选依赖）
@Autowired
public void setUserDao(UserDao userDao) {
    this.userDao = userDao;
}

// 3. 构造器注入（推荐！Spring 4.3+单构造器可省略@Autowired）
private final UserDao userDao;

public UserService(UserDao userDao) {
    this.userDao = userDao;
}
```

### @Autowired 注入流程

```
1. byType：从容器找 UserDao 类型的 Bean
2. 多个？→ byName：用字段名匹配 Bean name
3. 仍然多个？→ @Qualifier("userDao") 指定
4. 找不到？→ required=true 抛 NoSuchBeanDefinitionException
```

### 三级缓存解决循环依赖（面试高频）

```
singletonObjects (一级缓存)  ← 完整的Bean（初始化完成）
earlySingletonObjects (二级) ← 提前暴露的半成品Bean（实例化但未初始化）
singletonFactories (三级)    ← ObjectFactory（可创建代理对象）

A 依赖 B，B 依赖 A：
① 创建A → A实例化 → A的ObjectFactory放入三级缓存
② A填充属性 → 发现需要B → 去创建B
③ B实例化 → B填充属性 → 需要A
④ 从三级缓存拿到A的ObjectFactory → 调用getObject()得到早期A引用
⑤ 早期A放入二级缓存 → B拿到A引用 → B完成初始化 → B放入一级缓存
⑥ A拿到完成的B → A完成初始化 → A放入一级缓存
```

**为什么三级缓存？** 处理AOP代理：ObjectFactory.getObject() 会检查是否需要代理，保证循环依赖时注入的是代理对象。

## 三、AOP（面向切面编程）

### JDK 动态代理 vs CGLIB

```
┌─────────────────────────────────────┐
│  Spring AOP 代理选择                 │
│                                      │
│  目标类实现了接口？                   │
│     ├── 是 → JDK动态代理 (Proxy)     │
│     │        基于接口生成代理类        │
│     └── 否 → CGLIB代理               │
│              基于继承生成子类          │
│                                      │
│  强制CGLIB: @EnableAspectJAutoProxy  │
│  (proxyTargetClass=true)             │
└─────────────────────────────────────┘
```

### AOP 核心概念

```java
@Aspect
@Component
public class LogAspect {
    
    // 切入点：哪些方法被拦截
    @Pointcut("execution(* com.example.service.*.*(..))")
    public void servicePointcut() {}
    
    // 前置通知
    @Before("servicePointcut()")
    public void before(JoinPoint jp) { ... }
    
    // 环绕通知（最强大，可控制是否执行目标方法）
    @Around("servicePointcut()")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        // 前置逻辑
        Object result = pjp.proceed(); // 执行目标方法
        // 后置逻辑
        return result;
    }
}
```

### AOP 失效场景（面试陷阱）

```java
@Service
public class UserService {
    
    @Transactional
    public void methodA() { ... }
    
    public void methodB() {
        // ⚠️ 内部调用，不经过代理对象 → AOP失效！
        methodA();  // 事务不会生效
    }
    
    // 解决：注入自身代理
    @Autowired
    @Lazy
    private UserService self;
    
    public void methodBFixed() {
        self.methodA();  // ✅ 通过代理调用，事务生效
    }
}
```
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Spring IOC 你说是"控制反转——对象创建由容器管"，但 new 一个对象不简单吗，为什么搞这么复杂？**

new 对象简单，但"new 的依赖怎么来"复杂。场景：ServiceA 依赖 ServiceB，ServiceB 依赖 DataSource。如果用 new，ServiceA 里要 `new ServiceB(new DataSource(url, user, pwd))`，依赖链一长，创建代码爆炸，且耦合（ServiceA 知道 ServiceB 的实现细节）。IOC 的价值：一、解耦——ServiceA 只声明 `@Autowired ServiceB b`，Spring 容器负责创建 ServiceB 和它的依赖，ServiceA 不知道 ServiceB 的实现；二、生命周期管理——单例、原型等由容器控制，不用每个类自己管；三、可测试——单元测试时可以 mock 注入 ServiceB（如果 ServiceA 内部 new ServiceB，无法 mock）；四、AOP 基础——IOC 让 Spring 能接管对象创建，从而能在创建时包代理（实现事务、日志等）。所以 IOC 不是"让 new 变简单"，是"解耦 + 生命周期 + 可测试 + AOP"的综合收益。

### 第二层：证据与定位

**Q：Spring 依赖注入你用 @Autowired，但有时候注入失败（NoSuchBeanDefinitionException），你怎么定位？**

排查链路：一、确认 Bean 是否注册——看目标类有没有 @Component/@Service/@Configuration + @Bean，或 XML 配置。启动日志搜 "Bean of type 'X'" 看是否创建；二、确认包扫描——@ComponentScan 扫描的包路径是否包含目标类，如果类在 `com.example.service` 但 @ComponentScan 只扫 `com.example.controller`，不会被扫描；三、确认接口/实现——如果注入的是接口，Spring 找实现类，多个实现要 @Qualifier 指定，无实现抛 NoSuchBeanDefinitionException；四、条件注入——@Conditional/@Profile 可能导致 Bean 不创建（如 @Profile("prod") 在 dev 环境不生效）。定位手段：启动时加 `--debug` 看 Spring 的 condition 报告，或 Actuator 的 `/beans` 端点列出所有 Bean。常见根因：忘了 @Component、包扫描路径错、多个实现未指定 @Qualifier。

### 第三层：根因深挖

**Q：AOP 你说是"动态代理——JDK 动态代理或 CGLIB"，两者的选择标准是什么？为什么默认用 CGLIB（Spring Boot 2+）？**

JDK 动态代理要求"目标类实现接口"——它代理的是接口，用 `Proxy.newProxyInstance` 创建实现该接口的代理对象，invocationHandler 拦截方法调用。CGLIB 是"生成目标类的子类"——用 ASM 字节码库动态生成目标类的子类，重写方法加拦截，不要求接口。选择标准：有接口用 JDK 代理（或 CGLIB 也行）、无接口必须用 CGLIB。Spring Boot 2+ 默认 CGLIB 的原因：一、一致性——无论有无接口都用 CGLIB，行为一致，避免"有接口和没接口的代理行为不同"的困惑；二、性能——CGLIB 生成子类，方法调用是直接的方法重写（fast），JDK 代理是反射调用（稍慢）；三、注解继承——CGLIB 子类继承父类的注解（@Transactional 等），JDK 代理基于接口不继承目标类注解。代价：CGLIB 不能代理 final 类/方法（不能继承）、生成子类占内存。所以 CGLIB 是"通用 + 性能"的选择。

**Q：Spring 的 @Transactional 失效是经典坑，你说"自调用走不到代理"，根因是什么？怎么解决？**

@Transactional 基于 AOP 代理——Spring 创建 Service 的代理对象，代理在方法调用前后管理事务（开启、提交、回滚）。当外部调用 `serviceA.methodA()`，调用的是代理对象，代理拦截并应用事务。但"自调用"——`methodA` 内部调 `this.methodB()`（this 是目标对象不是代理对象），直接调目标对象的 methodB，绕过代理，methodB 上的 @Transactional 不生效。根因：this 指向目标对象（原始类实例），不是代理对象。解决方法：一、注入自身代理——`@Autowired private ServiceA self; self.methodB()` 通过代理调用（Spring 4.3+ 支持自注入，早期版本要 @Lazy 防循环）；二、用 AopContext——`((ServiceA) AopContext.currentProxy()).methodB()`，需开启 `@EnableAspectJAutoProxy(exposeProxy = true)`；三、重构——把 methodB 抽到另一个 Bean（ServiceB），ServiceA 注入 ServiceB 调用，避免自调用。推荐方法一（self 注入）最清晰。

### 第四层：方案权衡

**Q：构造器注入 vs @Autowired 字段注入，Spring 官方推荐构造器，为什么？**

构造器注入的优势：一、不可变——字段可以是 final（构造时赋值后不变），线程安全；二、强制依赖——不传依赖无法创建对象，编译期保证依赖完整（字段注入可以创建"缺依赖"的对象，运行时 NPE）；三、可测试——单元测试直接 new 对象传 mock，不依赖 Spring 容器（字段注入要反射设值或用 Spring Test）；四、循环依赖暴露——构造器注入的循环依赖会启动失败（Spring 不支持构造器循环依赖），暴露设计问题，字段注入的循环依赖 Spring 默认支持（但代码坏味道）。@Autowired 字段注入的"优势"是代码简洁（少写构造器），但这是用"隐藏风险"换"少写代码"。所以 Spring 官方推荐构造器注入，强制不可变 + 显式依赖 + 可测试。如果依赖多（>5 个），构造器参数长是代码坏味道（类职责过多），要拆类而非改注入方式。

**Q：@Configuration 和 @Component 的区别你说@Configuration 会被 CGLIB 代理，@Component 不会，为什么@Configuration 要代理？**

@Configuration 类的 @Bean 方法之间可能互相调用——如 `@Bean public A a() { return new A(b()); } @Bean public B b() { return new B(); }`。如果 @Configuration 不代理，a() 里调 b() 是普通方法调用，每次都 new B()，导致"多次调用 b() 返回不同实例"+"a 注入的 b 和容器里的 b 不是同一个"，破坏单例语义。CGLIB 代理 @Configuration 类后，a() 里调 b() 被代理拦截，先查容器有没有 b 这个 Bean，有则返回容器的单例，没有才执行 b() 方法并注册。这样保证 @Bean 方法返回的单例语义。@Component 不代理，所以 @Component 类里的 @Bean 方法互相调用是"普通调用"，每次 new 新实例——这是 @Configuration 和 @Component 的核心区别。所以"配置类用 @Configuration、普通组件用 @Component"，不要混用。

### 第五层：验证与沉淀

**Q：你怎么验证 @Transactional 真的生效（事务开启、回滚）？AOP 代理的细节怎么看？**

三步验证：一、日志——开启事务日志 `logging.level.org.springframework.orm.jpa=DEBUG`，看 "Creating new transaction" 和 "Committing/Rolling back" 日志；二、代理类型——`System.out.println(service.getClass().getName())`，如果是 `ServiceA$$EnhancerByCGLIB$$xxxx` 说明被 CGLIB 代理（AOP 生效），如果是原始类名 `ServiceA` 说明没代理（@Transactional 不生效）；三、回滚测试——在 @Transactional 方法里抛 RuntimeException，验证数据库无新数据（事务回滚）；抛 checked Exception 默认不回滚（要 @Transactional(rollbackFor = Exception.class)）。验证自调用失效：methodA 里调 this.methodB（methodB 有 @Transactional），methodB 抛异常不回滚（绕过代理），改用 self.methodB() 后回滚生效。这些验证确保事务配置正确，是排查"事务不生效"的标准手段。

**Q：这道题做完，你沉淀出了什么可复用的 Spring 原理知识？**

五条核心：一、IOC 解耦——对象创建交给容器，@Autowired 声明依赖，构造器注入优先（不可变 + 可测试）；二、AOP 代理——JDK 代理（有接口）或 CGLIB（无接口，Spring Boot 2+ 默认），@Transactional 基于代理；三、@Transactional 失效场景——自调用（this 调用）、final/static 方法、非 public 方法、内部类、异常被 catch 不抛出，遇到这些要排查；四、@Configuration vs @Component——@Configuration 被代理保证 @Bean 单例语义，@Component 不代理；五、Bean 生命周期——实例化→属性注入→初始化→使用→销毁，BeanPostProcessor 在初始化前后介入（AOP 在此生成代理）。这套知识用于排查 Spring 各种"不生效"问题——根因多是"代理没生成"或"绕过代理"，理解代理机制就能定位。


## 结构化回答

**30 秒电梯演讲：** IOC是「别人帮你创建对象」，AOP是「不改动原代码就能加功能」。依赖注入就是容器主动把依赖塞给你，而不是你自己去new。

**展开框架：**
1. **IOC=对象创建权交给容** — IOC=对象创建权交给容器，DI=容器自动注入依赖
2. **构造器注入最推荐** — 构造器注入最推荐（可final、不可变、强制依赖）
3. **三级缓存** — 三级缓存解决singleton循环依赖+AOP代理问题

**收尾：** 这块我踩过坑——要不要深入聊：Spring 三级缓存为什么不能是两级缓存？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Spring一句话：IOC是「别人帮你创建对象」，AOP是「不改动原代码就能加功能」。依赖注入就是容器主动把依赖塞给你…。" | 开场钩子 |
| 0:15 | 缓存读写策略流程图 | "IOC就是对象创建权交给容器，DI就是容器自动注入依赖" | IOC=对象创建权交给容 |
| 1:08 | 缓存读写策略流程图分步演示 | "构造器注入最推荐（可final、不可变、强制依赖）" | 构造器注入最推荐 |
| 2:01 | 关键代码/伪代码片段 | "三级缓存解决singleton循环依赖+AOP代理问题" | 三级缓存 |
| 2:54 | 对比表格 | "AOP默认JDK代理(有接口)/CGLIB(无接口)" | AOP默认JDK代理 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Spring 三级缓存为什么不能是两级缓存。" | 收尾 |
