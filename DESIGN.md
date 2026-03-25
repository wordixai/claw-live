# Design System — openclaw-live-stream (Control UI 浮层)

## Source of truth（重要）

- **运行时样式：** 以 `overlay/live-stream-overlay.js` 内注入的 **`<style>`（Design Tokens + 组件规则）** 为准 —— 这是 Control UI 里实际生效的 **浅色工具风** 界面。
- **`overlay/live-stream-overlay.css`：** 为 **另一套深色主题草稿**；`scripts/inject.sh` 会把它拷到 Control UI 目录，但 **默认不会在 `index.html` 里 `<link>`**，因此多数部署下 **不会加载**。若要做深色模式，应在 JS 中切换 token 或显式注入 link。
- **本文档：** 描述产品与语义规范；**像素级** 请以 JS 内 token（`--oc-*`）为准，并随代码更新同步改本节。

## Product Context

- **What this is:** 注入 OpenClaw **Control UI** 的浮层：直播画面、弹幕、状态与控制；演进方向含 **协助者/运营共看** 与 **结构化交接**（见 `~/.gstack/projects/live-openclaw/` 下设计稿与 CEO 计划）。
- **Who it's for:** 使用 OpenClaw 的 **运营/协作者**、以及 **协助排障与教学** 的一方；常在 **长时间会话、高压排障** 场景下使用。
- **Space / industry:** 开发者工具 / 直播与协作叠加层（寄生在宿主 Web UI 内）。
- **Project type:** **嵌入式 utility overlay**（非独立营销站、非全站 Design System）。

## Aesthetic Direction

- **Direction:** **Industrial / Utilitarian**（功能优先、偏暗色工具感）+ 少量 **Retro-Futuristic** 点缀（直播「信号/在线」隐喻）。
- **Decoration level:** **minimal → intentional**（以边框、微渐变、单点脉冲为主；忌堆叠装饰）。
- **Mood:** 「可靠的控制台」— 看得清状态、敢点按钮、长时间看不累；**不像** 消费级娱乐 App 的糖果色。
- **Host relationship:** 浮层 **不假设** Control UI 主题色；通过 **scoped** 样式（`#oc-live-overlay` 内）自闭环；若未来宿主提供 CSS 变量，再考虑 **optional token 对齐**。

## Typography

| 角色 | 建议 | 现状 | 说明 |
|------|------|------|------|
| UI 全文 | **System stack** 或 **DM Sans / Plus Jakarta Sans**（仅加载 2 字重） | `system-ui` 系 |  overlay 体量小，系统字体 **可接受**；若要品牌区分，**仅标题/按钮**用 webfont，避免整页加载。 |
| 数据/统计 | **tabular-nums** | 未统一 | 观众数、码率、延迟等数字建议 `font-variant-numeric: tabular-nums`。 |
| 弹幕 | 粗体 + 强描边/阴影 | 已有 `text-shadow` | 保持；注意 **过长弹幕** 截断与 **敏感内容** 样式（未来）。 |

**Avoid (gstack / 行业反模式):** 全站 Inter/Roboto 作为「唯一品牌」、紫色渐变主 CTA、千篇一律三列图标功能块（与本项目无关但禁止带入后续营销页）。

## Color

### 现状基线（代码中）

- 面板背景 `#0f0f1a`，体 `#000`，页脚 `#111127`
- 强调色 **`#ef4444`（红）** — LIVE、主按钮、焦点环、toggle
- 文本灰阶 `#e0e0e0` / `#888` / `#666` / `#555`

### 建议演进（SAFE + RISK）

**SAFE（保持）**

- **深色中性底** + **细白描边**（`rgba(255,255,255,0.06–0.08)`）— 与 IDE/控制台类别一致。
- **高对比** 弹幕与视频上文字。

**RISK（建议考虑）**

- **「红 = 直播中」** 与 **「红 = 错误」** 在工具 UI 中易混淆。建议：
  - **LIVE / 推流中** 保留红或改为 **更饱和的 broadcast red**，并配 **「LIVE」文案** 而非仅靠颜色；
  - **空闲/就绪** 用 **青绿/琥珀** 小点，与错误态 **明确分区**（错误用另一 token，如 `#f59e0b` 警告 / `#ef4444` 仅致命）。
- **协助/共看叙事：** 可增加 **secondary accent**（如 `#22d3ee` 或 `#38bdf8`）用于 **「观看链接」「协助模式」**，与「推流红」分工 — **Completeness：** 定义语义色表后写进本文档「Semantic colors」。

### Semantic colors（建议表，实施时对齐）

| Token | 用途 | 建议 hex |
|-------|------|----------|
| `--oc-accent-live` | 正在直播/推流 | `#ef4444`（或略偏橙） |
| `--oc-accent-assist` | 分享/观看/协助 | `#22d3ee` |
| `--oc-warn` | 降级、非致命错误 | `#f59e0b` |
| `--oc-danger` | 阻断性失败 | `#dc2626` |
| `--oc-success` | 已连接/就绪 | `#34d399` |

## Layout & Spacing

- **Base unit:** **4px**；面板内边距保持 **8 / 12 / 14** 阶梯（与现 CSS 接近）。
- **最小触控：** 头部图标按钮 **24×24** 对桌面 OK；若目标含 **平板**，建议 **44×44** 命中区域（透明 padding）。
- **Resize handle：** 现 **14×14** 偏小；建议 **≥ 20px** 或增加 **角标热区**。
- **层次：** Header（拖曳 + 状态） / Body（视频 + 弹幕层） / Footer（输入 + 统计）— **不要随意打乱**，新增「交接/诊断」入口放 **header 二级菜单** 或 **footer 左侧图标**，避免挤占弹幕输入。

## Motion

- **脉冲 LIVE 点：** 有效但可能干扰；建议 **`prefers-reduced-motion: reduce`** 时改为 **静态高亮**。
- **过渡：** 现有 `0.15s–0.3s` 合理；全屏切换保留 **短促** 即可。

## Components — 当前与待扩展

| 组件 | 设计注意 |
|------|----------|
| 浮层容器 | `z-index: 99999` — 与宿主冲突时要有 **文档说明**；最小化/全屏 **状态可感知**（ARIA / `aria-expanded`）。 |
| 主按钮 | 红色实心 — 与 **destructive** 区分：文案必须是 **「开始推流」** 等，避免泛用「删除」色。 |
| 输入框 | 圆角 pill — OK；**focus 环** 已有红边，建议 **2px outline** 满足键盘用户。 |
| 占位/等待 | spinner 红顶 — 与 **加载 / 等待协助者** 语义一致；**空状态** 需 **一句人话 + 主操作**（未来 handoff）。 |
| 未来：观看链接 | **过期/撤销** 需 **可见反馈**（toast 或 inline），忌静默失败。 |
| 未来：评价/解决确认 | 使用 **明确二元 + 可选文字**，避免只有 emoji。 |

## Accessibility & Trust

- **对比度：** `#888` / `#666` 小字在渐变头上可能 **低于 WCAG AA** — 建议 **stats 至少 `#a3a3a3`** 或 **字号 ≥ 12px**。
- **键盘：** 拖曳以外的主路径（开始、发送弹幕、最小化）应 **可 Tab + Enter**（需 JS 配合）。
- **共看/隐私：** 任何 **分享** 入口旁 **一行风险提示**（谁可见、是否录屏）— 设计层预留 **文案位**。

## Competitive / Landscape（未跑浏览器抓图；原则层）

- **Layer 1（类别共性）：** 暗色、强状态指示、数据密排 — 应保留。
- **Layer 2（趋势）：** 柔和圆角、微玻璃 — **可选用**，勿牺牲信息密度。
- **Layer 3（本产品）：** 差异点应在 **「协助可信」**（语义色、交接、诊断）而非 **炫酷背景**。

## Implementation Notes

- 令牌建议以 `#oc-live-overlay` 下 **CSS 自定义属性** 集中定义，便于主题切换与与宿主对齐。
- 修改后跑 **`scripts/inject.sh`** 对接到本地 Control UI 做 **肉眼回归**。

## Changelog

- **2026-03-24:** 初版 — 由 gstack `design-consultation` 流程根据现有 `overlay/live-stream-overlay.css` 与产品方向整理。
