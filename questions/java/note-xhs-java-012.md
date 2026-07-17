---
id: note-xhs-java-012
difficulty: L2
category: java
subcategory: JVM
tags:
- 拼多多
- Java服务端
- OOM
- HeapDump
- JVM参数
- 面经
feynman:
  essence: "OOM时没有Dump文件，是因为JVM启动参数没配置自动Dump。解决方法是添加-XX:+HeapDumpOnOutOfMemoryError参数，或手动用jmap/jcmd触发"
  analogy: "就像出门忘带手机拍照——事故发生了但没有照片证据。解决方法很简单：设置'自动拍照'参数，下次事故自动留证"
  key_points:
  - 根因：JVM默认不自动生成Heap Dump
  - 启动参数：-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/path
  - 手动触发：jmap -dump 或 jcmd GC.heap_dump
  - 进阶：JMX + 脚本在OOM前自动Dump（设阈值）
  - 预防：上线前就配好Dump参数
first_principle:
  essence: "问题的本质是'缺少配置'而非'技术限制'。JVM有能力生成Dump，只是默认不开启"
  derivation: "OOM发生了→想要分析→需要Heap Dump→但默认不生成→因为性能开销→生产环境应该主动开启→添加JVM参数→下次OOM自动生成"
  conclusion: "一个JVM参数解决的问题，关键在于上线前配好而不是事后补"
follow_up:
- Dump文件很大（几个GB），如何高效分析？（MAT可以分析>2GB的Dump，需要调大MAT内存）
- -XX:+HeapDumpOnOutOfMemoryError对性能有多大影响？（几乎为零，只在OOM时触发）
- 如何在OOM之前就拿到Dump？（设置内存使用率阈值，脚本定时检查触发Dump）
- 如果jmap命令执行也失败了（内存不足），怎么办？（用gcore生成core dump再转换）
- 生产环境上线前你还配置过哪些JVM参数？
memory_points:
- "JVM参数: -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/dumps/"
- "手动触发: jmap -dump:format=b,file=heap.hprof <pid>"
- "JDK11+: jcmd <pid> GC.heap_dump /path/heap.hprof"
- "OOM前的预防性Dump: 脚本监控heap使用率 > 85%时自动触发"
---

# 【拼多多 Java服务端】OOM时JVM没自动生成Dump文件怎么办？

> 来源：拼多多211本硕Java服务端面经（已OC）（小红书）

## 一、问题原因与解决

```
┌──────────────────────────────────────────────────────────┐
│             为什么没有自动生成Dump？                       │
│                                                          │
│  JVM默认行为:                                             │
│  ┌──────────────────────────────────────────────────┐    │
│  │ OOM → 打印异常堆栈 → 进程退出                     │    │
│  │ （不生成Dump文件！）                                │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  解决方案:                                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 方案A: 添加JVM启动参数 (根治)                      │    │
│  │ -XX:+HeapDumpOnOutOfMemoryError                  │    │
│  │ -XX:HeapDumpPath=/data/dumps/                    │    │
│  │ → 下次OOM自动生成Dump                              │    │
│  │                                                    │    │
│  │ 方案B: 当前运行中手动触发 (临时)                    │    │
│  │ jmap -dump:format=b,file=heap.hprof <pid>       │    │
│  │ jcmd <pid> GC.heap_dump /data/dumps/heap.hprof  │    │
│  │                                                    │    │
│  │ 方案C: 预防性Dump (在OOM前触发)                    │    │
│  │ 脚本监控heap使用率 > 85%时自动Dump                 │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## 二、推荐JVM参数配置

```bash
# 生产环境推荐配置
java \
  -Xms4g -Xmx4g \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/data/dumps/ \
  -XX:+PrintGCDetails \
  -XX:+PrintGCDateStamps \
  -Xlog:gc*,gc+heap=debug:file=/data/logs/gc.log:time,uptime,level,tags \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -jar app.jar
```

| 参数 | 作用 | 说明 |
|------|------|------|
| -XX:+HeapDumpOnOutOfMemoryError | OOM时自动Dump | 生产必配 |
| -XX:HeapDumpPath | Dump文件存储路径 | 确保磁盘空间充足 |
| -XX:OnOutOfMemoryError | OOM时执行脚本 | 可触发告警+Dump |
| -XX:+ExitOnOutOfMemoryError | OOM时直接退出 | 容器环境自动重启 |
| -XX:+CrashOnOutOfMemoryError | OOM时生成core dump | 需要更底层分析时 |

## 三、预防性自动Dump脚本

```bash
#!/bin/bash
# auto_dump.sh - OOM前自动Dump
PID=$(jps -l | grep 'app.jar' | awk '{print $1}')
THRESHOLD=85  # heap使用率阈值(%)

while true; do
    # 获取heap使用率
    USAGE=$(jstat -gcutil $PID 1000 1 | tail -1 | awk '{print $1}')
    
    if [ "$USAGE" -gt "$THRESHOLD" ]; then
        echo "$(date) - Heap usage: ${USAGE}% > ${THRESHOLD}%, triggering dump"
        jcmd $PID GC.heap_dump /data/dumps/heap_$(date +%Y%m%d_%H%M%S).hprof
        # 发送告警
        curl -X POST "https://oapi.dingtalk.com/robot/send?access_token=xxx" \
             -H "Content-Type: application/json" \
             -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"OOM预警: Heap ${USAGE}%\"}}"
        break
    fi
    sleep 10
done
```

## 四、面试加分点

1. **OnOutOfMemoryError脚本**：`-XX:OnOutOfMemoryError="/data/scripts/on_oom.sh %p"` 可在OOM时执行自定义脚本（发送告警、清理缓存、自动Dump）
2. **Heap Dump文件大小**：Dump文件大小约等于堆内存大小（-Xmx值），4G堆约生成4G Dump文件，确保磁盘空间
3. **Live Dump vs Full Dump**：`jmap -dump:live,format=b` 只Dump存活对象（先触发一次GC），文件更小但可能遗漏信息
4. **容器环境**：K8s中配 `livenessProbe` + `ExitOnOutOfMemoryError` 让Pod自动重启；Dump文件需挂载持久卷
5. **APM工具集成**：SkyWalking/Pinpoint等APM工具可配置OOM自动Dump并上传到对象存储（OSS/S3），避免本地磁盘不足

## 结构化回答

**30 秒电梯演讲：** 就像出门忘带手机拍照——事故发生了但没有照片证据。解决方法很简单：设置'自动拍照'参数，下次事故自动留证

**展开框架：**
1. **根因** — JVM默认不自动生成Heap Dump
2. **启动参数** — -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/path
3. **手动触发** — jmap -dump 或 jcmd GC.heap_dump

**收尾：** Dump文件很大（几个GB），如何高效分析？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：【拼多多 Java服务端】OOM时JVM没自动生成Dump文 | "就像出门忘带手机拍照——事故发生了但没有照片证据。解决方法很简单：设置'自动拍照'参数，下次事故自动" | 引入 |
| 0:20 | 概念图解 | "JVM默认不自动生成Heap Dump" | 根因 |
| 0:45 | 对比表格 | "-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/path" | 启动参数 |
| 1:15 | 总结卡 | "记住三个词：根因、启动参数、手动触发" | 收尾 |
