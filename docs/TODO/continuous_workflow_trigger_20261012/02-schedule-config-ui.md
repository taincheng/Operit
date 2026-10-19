# 连续运行的配置界面与文案

## 旧状态

- `ScheduleConfigDialog` 的定时类型下拉只有「固定间隔 / 特定时间 / Cron 表达式」，见 `ui/features/workflow/components/ScheduleConfigDialog.kt`
- 固定间隔只有「数值 + 单位（分钟/小时/天）」，并在下方提示「WorkManager 最小间隔为 15 分钟」
- 新建定时触发节点的默认配置是 `{"schedule_type":"interval","interval_ms":"900000",...}`，见 `ui/features/workflow/screens/WorkflowDetailScreen.kt`
- 导出配置时对所有类型都写 `repeat`

## 意图

- 下拉新增「连续运行」
- 选中后显示最小间隔与最大间隔两个输入框（单位：秒），默认 30 / 120
- 校验：两个值都要是正整数且 `min <= max`，非法时禁用确认按钮并给出提示
- `continuous` 不写 `repeat`，界面上也不显示「重复」开关（连续调度本身就是反复运行）
- 新建定时触发节点的默认配置保持 `interval`，不改变既有用户的直觉；连续运行由模板与手动配置选择

## 实现

`triggerConfig` 契约：

```json
{
  "schedule_type": "continuous",
  "min_gap_ms": "30000",
  "max_gap_ms": "120000",
  "enabled": "true"
}
```

界面状态：

```kotlin
var continuousMinGapSeconds by remember { mutableStateOf(initialConfig["min_gap_ms"]?.toLongOrNull()?.let { it / 1000 }?.toString() ?: "30") }
var continuousMaxGapSeconds by remember { mutableStateOf(initialConfig["max_gap_ms"]?.toLongOrNull()?.let { it / 1000 }?.toString() ?: "120") }
val continuousGapValid = 两个值都是正整数且 min <= max
```

新增文案键（源语言中文，另加 7 个已有同类键的语种）：

| 键 | 中文 |
| --- | --- |
| `workflow_schedule_type_continuous` | 连续运行 |
| `workflow_continuous_config_title` | 连续运行配置 |
| `workflow_continuous_min_gap_label` | 最小间隔（秒） |
| `workflow_continuous_max_gap_label` | 最大间隔（秒） |
| `workflow_continuous_gap_hint` | 一轮执行完成后随机等待该区间内的时长再开始下一轮，间隔从上一轮结束时刻起算 |
| `workflow_continuous_gap_invalid` | 两个间隔都要是正整数，且最大间隔不小于最小间隔 |

`values-ja` 目前没有这一组工作流调度文案，按同样口径不补（`check_localizations.py` 只报统计，不把「缺翻译」算作失败）。

## 验证方式

真机（见 [04](04-verification.md)）：新建/编辑定时触发节点，选「连续运行」，确认生成的 JSON 是上表契约；把最大间隔填得比最小间隔小，确认确认按钮被禁用。

[DONE]
