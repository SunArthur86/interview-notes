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