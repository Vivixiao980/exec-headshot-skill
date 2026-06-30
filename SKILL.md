---
name: exec-headshot
description: >
  Generate executive-style professional headshots (高管风职业照/证件照) from a
  user-uploaded photo, with multiple selectable styles.
  Triggers: "生成职业照", "高管照", "职业头像", "证件照", "高管风", "形象照",
  "领英头像", "LinkedIn头像", "团队页照片", "professional headshot",
  "executive headshot", "corporate portrait".
  Also trigger when user uploads a personal photo and asks to make it look
  professional / executive / suitable for resume, LinkedIn, or company website.
metadata:
  openclaw:
    requires:
      bins:
        - node
    primaryEnv: HEADSHOT_API_KEY
    emoji: "📸"
---

# 高管职业照生成器

用户上传一张普通照片（自拍、生活照均可），生成高管风格的职业照/证件照。
保持人物身份一致（像本人），更换着装、背景、光线为专业影棚效果。

- **作者**：Vivi
- **支持风格**：11 种预设风格（见下方风格表）
- **美颜档位**：`off / light / medium` 三档可控，默认 `light`（海马体精修级：轻微小脸 + 自然淡妆 + 增发蓬松）
- **技术原理**：用户照片 + 风格提示词 → 图像编辑模型生成影棚级职业肖像。**双路执行**：Codex 等有原生生图能力的平台直接用原生 GPT Image（零配置）；Claude Code / OpenClaw 走 `generate.mjs` 脚本 + 外部图像编辑 API
- **可移植核心**：`styles/*.json` 的 11 套风格提示词 + 身份锁定/姿态矫正/美颜规则——不论谁执行（Codex 原生 / gpt-image-2 / nano banana）都通用

---

## 路径约定

本 Skill 的脚本位于 SKILL.md 所在目录。执行任何命令前，先确定 `SKILL_DIR`：

- **Claude Code**：`~/.claude/skills/exec-headshot`
- **Codex**：`~/.codex/skills/exec-headshot-skill`
- **OpenClaw**：`~/.openclaw/skills/exec-headshot`
- **本地开发**：`~/Documents/coding/exec-headshot-skill`

后续所有 `${SKILL_DIR}` 均指此路径，不要硬编码。

---

## 工作流入口

触发后，先判断用户意图：

- **生成职业照**（默认）：用户上传照片想要职业照 → 进入下方「执行流程」
- **修改/重生成**：用户对已生成的照片提出调整（换背景色、换风格、表情、着装细节）→ 用**原始照片**重新生成，把调整要求放进 `--notes`；不要拿生成结果再次喂给模型（会损失人脸相似度）
- **多风格对比**：用户说「每种都来一张」「帮我多生成几种风格」→ 依次对多个风格各生成 1 张，每次之间 `sleep 8`

---

## 执行流程

### Step 0：平台分流（先决定用什么生成）

**判断当前平台有没有原生图像生成/编辑能力：**

- ✅ **有原生生图（如 Codex 内置 GPT Image）→ 优先用原生，零配置、无需任何 API Key。** 按下方「原生生成」执行，跳过 Step 1 的配置。
- ❌ **Claude Code / OpenClaw（模型自身不能生成图片）→ 走 Step 1 起的脚本流程**（需配置图像编辑 API）。

> 为什么分流：Codex 能直接调用原生 GPT Image 做图像编辑，最省事；而 Claude / OpenClaw 的模型本体不产图，必须靠 `generate.mjs` 调外部图像编辑 API。两条路用的是**同一套风格提示词**，效果一致。

#### 原生生成（Codex 推荐，零配置）

输入要素：用户照片 + 风格ID + 美颜档位（默认 light）+ 比例（默认 3:4）。

执行：读取 `styles/{风格ID}.json` 的 `prompt` 字段，按下面模板拼成完整提示词，连同用户照片一起交给原生图像编辑能力生成：

```text
{粘贴 styles/{风格ID}.json 里 prompt 字段的完整内容}

【人物身份锁定 —— 最高优先级，凌驾风格之上】
画面必须是输入照片里的同一个人：脸型轮廓和长宽比、下颌线和下巴、眼睛大小与形状、鼻型、唇形、肤色、发际线、发色全部保持一致；痣、酒窝、牙套等标志性特征绝不修掉。只允许「轻微」美化，不大幅改骨相和五官间距，熟人一眼认得出是本人。

【姿态与眼神矫正】
无论原照角度如何（低头/侧脸/斜视/说话张嘴/视频截图/镜像画面），都矫正为标准职业照姿态：头部端正、面部完全正面或向右微偏≤15度、双肩放平、双眼直视镜头且眼神有神。移除原照里的麦克风/工牌/耳机等杂物。若原图是镜像（背景文字反向），按真实方向还原人物。

【美颜档位：{light|medium|off}】
- light（默认，海马体精修级）：轻微收下颌显小脸（绝不削尖锥、不缩短脸）；自然淡妆（顺眉、睫毛分明、自然腮红、裸色饱满唇、卧蚕眼神光）；增发蓬松（颅顶微增高、消除发缝空隙、统一发色、收碎发不遮眼）；匀肤提亮、淡化黑眼圈、牙齿微白。明显变好看但仍一眼是本人。
- medium（写真精修级）：脸更小、妆更精致、眼睛更亮，仍是本人但偏精修。
- off：纯还原，不做任何美化。

【画质与比例】真实摄影照片质感（非插画/3D）；保留皮肤真实毛孔纹理，禁止塑料磨皮；肩宽明显大于头宽（>2倍）、头部占画面高 28%–38% 防止头大身小；画面只有这一个人；不加任何文字、水印、logo、边框。输出 {比例} 图片。
```

生成后用 Read 展示并做相似度自检（同 Step 5）。用户要换风格/调整时，**始终用原始照片**重新生成，不要拿生成结果二次编辑（会掉相似度）。

#### 脚本生成（Claude Code / OpenClaw）

继续下方 Step 1 ~ Step 5。

---

### Step 1：检查配置（首次使用 Onboarding）

```bash
cat ~/.config/exec-headshot/config.json 2>/dev/null || cat ~/.config/xhs-cover/config.json 2>/dev/null
```

**任一文件存在且有 `apiKey` 字段 → 跳到 Step 2**（脚本会自动复用 xhs-cover 的配置，无需重新配置）。

否则进入 Onboarding：

1. 向用户介绍：
   ```
   📸 欢迎使用高管职业照生成器！
   一张自拍 → 影棚级高管职业照，支持 11 种风格 + 海马体级美颜。
   首次使用需要配置一次图像生成 API，之后每次直接生成。
   ```

2. 用 AskUserQuestion 询问 API 来源：
   - **Google AI Studio（官方）**：https://aistudio.google.com/apikey 获取 Key（AIza 开头），baseUrl 用 `https://generativelanguage.googleapis.com/v1beta/openai`，模型名查 https://ai.google.dev/gemini-api/docs/models 中支持图像生成的最新型号，`apiFormat` 用 `chat`
   - **第三方代理（Chat Completions 格式）**：需要 Base URL、API Key、模型名三项，`apiFormat` 用 `chat`（请求体为带 image_url 的 messages）
   - **第三方代理（Images API 格式）**：如 Aigate 等只提供 `/v1/images/edits` 的服务（gpt-image 系模型），`apiFormat` 用 `images`

3. 用 Write 写入 `~/.config/exec-headshot/config.json`：
   ```json
   {
     "apiType": "google 或 third-party",
     "apiFormat": "chat 或 images",
     "apiKey": "...",
     "baseUrl": "...",
     "model": "...",
     "outputDir": "~/Desktop/职业照",
     "defaultAspectRatio": "3:4"
   }
   ```
   写入前先 `mkdir -p ~/.config/exec-headshot`，写入后 `chmod 600 ~/.config/exec-headshot/config.json`。

4. 测试连通性：`node ${SKILL_DIR}/scripts/generate.mjs --test`

### Step 2：收集生成参数

用 **一次** AskUserQuestion 收集（用户已提供的跳过）：

**① 照片路径**（必填）
- 用户上传的图片或本地绝对路径，支持 JPG/PNG/WebP
- 给用户的拍摄建议：正面或微侧、面部清晰无遮挡、光线均匀的照片效果最好；自拍也可以
- **刁钻角度可自动矫正**：低头/侧脸/看别处/说话中/视频截图等非标准姿态，会自动矫正为目视镜头的标准职业照姿态（全局规则内置）；但面部像素信息越完整，相似度越高，所以仍优先建议清晰正面照

**② 风格**（必填，见 Step 3）

**③ 比例**（单选，默认 3:4）
| 选项 | 方向 | 适用 |
|------|------|------|
| 3:4（默认） | 竖屏 | 标准证件照/简历/官网团队页 |
| 4:5 | 竖屏 | 小红书、个人主页、海报人像位 |
| 9:16 | 竖屏 | 手机全屏、视频封面 |
| 1:1 | 方形 | 微信/钉钉/飞书/LinkedIn 等社交头像 |
| 4:3 | 横屏 | 横版人像、网页 banner 人物位 |
| 16:9 | 横屏 | 演讲海报、PPT 讲者页、视频画面 |

**④ 美颜档位**（单选，默认 light）→ 传给 `--beautify`
| 档位 | 效果 | 适用 |
|------|------|------|
| `light`（默认） | 海马体精修级：轻微小脸 + 自然淡妆 + 增发蓬松 + 提气色，明显变好看但一眼是本人 | 职业照/证件照主用 |
| `medium` | 写真精修级：脸更小、妆更精致、眼更亮，仍是本人但偏精修 | 小红书/社交头像 |
| `off` | 纯还原，不做任何美化，最大化保真 | 强调真实、证件审核严格时 |

**⑤ 张数**（默认 1，最多 5；同一风格多张可挑选最像的一张）

**⑥ 额外要求**（可选）→ 传给 `--notes`
- 例如：`蓝底`、`不戴眼镜`、`头发扎起来`、`穿白色西装`、`表情严肃一点`

### Step 3：风格选择

如果用户没有明确指定风格，用 AskUserQuestion 展示风格表让用户选（可多选）：

| 风格ID | 名称 | 一句话描述 | 适合 |
|--------|------|-----------|------|
| `apple-executive` | 苹果高管风 | 深灰渐变背景+黑色上装，Apple 官网同款 | 最经典高管风，默认推荐 |
| `navy-american` | 美式深蓝幕布 | 藏蓝画布幕布，美式 corporate 风 | 小红书爆款「美式证件照」 |
| `blue-gray-elegant` | 高智感蓝灰 | 蓝灰纹理幕布+微侧回眸+精致淡妆 | 小红书「高智感职业照」 |
| `light-gray-minimal` | 浅灰极简 | 明亮浅灰背景+黑色上装，黑白对比 | 个人主页、现代官网 |
| `cinematic-dark` | 暗调电影感 | 近黑背景+轮廓光，气场最强 | 杂志封面、主视觉 |
| `classic-business` | 经典商务 | 浅灰背景+深色西装白衬衫 | LinkedIn、简历、名片 |
| `bw-editorial` | 黑白杂志 | 黑白伦勃朗光，财经杂志专访风 | 个人品牌、演讲海报 |
| `warm-approachable` | 浅暖亲和 | 米白暖调背景+大地色着装 | 顾问、讲师、教练 |
| `tech-founder` | 科技创始人 | 纯白背景+深色T恤/休闲西装 | 创业官网、路演 PPT |
| `standard-id` | 标准证件照 | 纯色背景正面照（白/蓝/红底） | 签证、工作证、简历 |
| `korean-id` | 韩式质感证件照 | 海马体同款：浅底+韩式精修+精致发丝 | 小红书「韩系证件照」 |

**按背景色快速对应**（用户用背景色描述需求时）：
- 深灰背景 → `apple-executive`；浅灰背景 → `light-gray-minimal`（黑上装）或 `classic-business`（西装）
- 蓝色背景 → `navy-american`（深藏蓝幕布）/ `blue-gray-elegant`（浅蓝灰幕布，更柔美）/ `standard-id` + notes「蓝底」（纯色证件）
- 黑色背景 → `cinematic-dark`；白色背景 → `tech-founder`；暖色背景 → `warm-approachable`

**自动推荐规则**（用户让你帮忙选时）：
- 默认/说「高管风」→ `apple-executive`
- 提到「美式」「电影质感的蓝底」→ `navy-american`
- 提到「高智感」「优雅」「氛围感」，或女性用户想要更柔美的蓝底 → `blue-gray-elegant`
- 提到简历、LinkedIn、求职 → `classic-business` + `apple-executive`
- 提到签证、入职、工作证、纯色底 → `standard-id`
- 提到创业、融资、官网 → `tech-founder`
- 提到讲课、咨询、亲和 → `warm-approachable`
- 想要「有气场」「高级感」→ `cinematic-dark` + `bw-editorial`
- 提到「韩式」「海马体」「精修证件照」→ `korean-id`
- 拿不准时 → 推荐先用 `apple-executive` + `navy-american` + `cinematic-dark` 各生成 1 张对比

**进阶玩法：高管卡片（Executive Profiles 梗图）**
小红书爆款格式：把生成的职业照做成 Apple 官网「Executive Profiles」卡片——照片下方白色横条写姓名+头衔（如 Customer / Senior Vice President and General Counsel）。实现方式：任选风格生成时在 `--notes` 中加：`图片底部加白色横条区域，左对齐两行文字：第一行蓝色小字"<姓名>"，第二行黑色稍大字"<头衔>"，模仿企业官网高管介绍卡片排版，字体现代无衬线`。

### Step 4：运行生成

```bash
node ${SKILL_DIR}/scripts/generate.mjs \
  --image "照片绝对路径" \
  --style "风格ID" \
  --beautify light \
  --notes "额外要求（如有）" \
  --count 张数 \
  --aspect-ratio "比例" \
  --output-dir "输出目录（可省略，默认 ~/Desktop/职业照）"
```

可选参数：`--beautify off|light|medium`（默认 light）、`--mirror`（成片水平翻转，修复「像又不像」）。

API 凭证由脚本自动从配置文件读取（exec-headshot 配置优先，自动兜底复用 xhs-cover 配置）。

**生成多种风格时**：依次执行，每次之间 `sleep 8`（避免并发导致 TLS 断开）。

查看全部可用风格：`node ${SKILL_DIR}/scripts/generate.mjs --list-styles`

### Step 5：展示结果与相似度检查

1. 用 Read 工具读取并展示每张生成的图片（文件路径 + 预览）。
2. **主动做相似度自检**：对比原照片和生成图，如果发现五官明显走样（脸变瘦、眼睛变大、年龄变小），告知用户并建议：
   - 换一张正面、光线更好的原照片
   - 同风格多生成 2-3 张挑选
   - 在额外要求中加：`严格保持与原照片相同的脸型和五官，不要美化`
3. 询问用户是否满意，不满意则收集具体调整点，回到 Step 4 用原始照片重新生成。

---

## 配置管理

- **修改配置**：用户说「重新配置」「换 API」→ 重走 Step 1 的 Onboarding，直接覆盖写入
- **查看配置**：`cat ~/.config/exec-headshot/config.json`，输出时隐藏 apiKey 中间部分（只显示前 8 位和后 4 位）

---

## 常见问题处理

**美颜程度**（用 `--beautify` 档位控制）：
- 默认 `light`（海马体精修级：轻微小脸 + 自然淡妆 + 增发蓬松 + 提气色，仍保留本人辨识度）。想更美 → `--beautify medium`；想纯还原 → `--beautify off`
- 三档都锁死五官结构和辨识度（牙套/痣等特征保留），只是美化幅度不同
- 头身比例已约束（肩宽 > 2 倍头宽、头部占画面高 28%–38%）；若仍出现头大 → notes 加 `头部比例小一些，多留肩部和上身`

**生成的人不像本人**：
- 最常见原因是原照片侧脸/遮挡/光线差，建议换正面清晰照
- **觉得「像又不像」「哪里说不上来的怪」→ 大概率是镜像问题**（生图模型常把人脸左右翻转，人对自己的镜像脸和真实脸感知不同）。重跑时加 `--mirror` 把成片水平翻转回来，小红书爆款帖验证的高频技巧
- **最高频的走样模式是「脸被画圆、画短、网红化」**（模型先验偏圆润年轻脸）。全局规则已内置脸型长宽比锁定 + 英文 IDENTITY LOCK，若仍走样，在 `--notes` 加针对性描述，如：`这个人是长脸型，下巴偏尖，必须保持`
- 提示词里的妆容/气质形容词会触发「美颜脸」，自定义风格时避免「微醺感」「水光唇」「氛围感美女」这类网红词
- 大角度侧身构图会放飞脸部，落点保持在「身体侧转 ≤20 度、脸基本朝镜头」最稳
- 同风格生成 3 张挑选（`--count 3`）

**API Key 错误（401/403）**：
- Google：检查 Key 是否 `AIza` 开头、科学上网是否正常
- 第三方：检查 Key 和 Base URL 是否匹配

**连接超时/TLS 断开**：偶发网络问题，重试即可；不要并发请求

**模型拒绝生成人像**：部分模型对人脸编辑有限制，换支持人像编辑的模型（如 Gemini 图像系列）

**证件照需要特定底色**：用 `standard-id` 风格 + `--notes "蓝底"` 或 `--notes "红底"`

**签证/官方证件用途（评论区高频问题）**：
- 生成的是「照片内容」，提交前需按目标用途的规格裁剪（如日本签证 45×45mm、中国签证 33×48mm 等），尺寸要求让用户自行确认官方规定
- 眼镜：多数签证要求免冠免镜，原照戴眼镜时建议 `--notes "去掉眼镜"`；是否可戴以签发机构规定为准，主动提醒用户
- AI 证件照已有日本签证实测出签案例，但不同国家审核不同，正式用途建议提醒用户自担风险

**用户关心照片隐私时**：说明照片仅发送给用户自己配置的图像 API（配置文件里的服务商），本 Skill 不上传到任何其他服务器、不留存

---

## 新增自定义风格

在 `${SKILL_DIR}/styles/` 下新建 `{style-id}.json`：

```json
{
  "name": "风格中文名",
  "description": "一句话描述",
  "tags": ["标签"],
  "prompt": "完整的生成提示词..."
}
```

Prompt 撰写要点（参考现有风格文件的结构）：
1. 开头一句话定义任务和对标效果
2. 【身份一致性】放最前面且标注最高优先级
3. 依次写【构图】【着装】【背景】【光线】【画质与修图】【表情】
4. 结尾【禁止事项】：禁改五官/禁过度磨皮/禁文字水印
