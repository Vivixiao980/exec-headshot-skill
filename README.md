# 📸 高管职业照生成器（exec-headshot）

上传一张普通照片（自拍、生活照均可），生成影棚级**高管风职业照/证件照**。
保持人物身份一致（像本人），自动更换着装、背景、光线为专业摄影棚效果。

## 支持风格

| 风格 | 效果 | 适合场景 |
|------|------|---------|
| 苹果高管风 `apple-executive` | 深灰渐变背景 + 黑色上装，Apple Leadership 页同款 | 最经典高管风 |
| 美式深蓝幕布 `navy-american` | 藏蓝画布幕布，美式 corporate photography 风 | 小红书爆款「美式证件照」 |
| 高智感蓝灰 `blue-gray-elegant` | 蓝灰纹理幕布 + 微侧回眸 + 精致淡妆 | 小红书「高智感职业照」 |
| 浅灰极简 `light-gray-minimal` | 明亮浅灰背景 + 黑色上装，黑白对比干净 | 个人主页、现代官网 |
| 暗调电影感 `cinematic-dark` | 近黑背景 + 轮廓光，气场最强 | 杂志封面、主视觉 |
| 经典商务 `classic-business` | 浅灰背景 + 深色西装白衬衫 | LinkedIn、简历、名片 |
| 黑白杂志 `bw-editorial` | 黑白伦勃朗光，财经杂志专访风 | 个人品牌、演讲海报 |
| 浅暖亲和 `warm-approachable` | 米白暖调背景 + 大地色着装 | 顾问、讲师、教练 |
| 科技创始人 `tech-founder` | 纯白背景 + 深色T恤/休闲西装 | 创业官网、路演 PPT |
| 标准证件照 `standard-id` | 纯色背景正面照（白/蓝/红底） | 签证、工作证、简历 |
| 韩式质感证件照 `korean-id` | 海马体同款：浅底 + 韩式精修 + 精致发丝 | 小红书「韩系证件照」 |

## 美颜档位（海马体精修师标准）

用 `--beautify` 控制美化强度，三档都锁死五官结构和辨识度（牙套/痣等特征保留）：

| 档位 | 效果 | 适用 |
|------|------|------|
| `light`（默认） | 轻微小脸 + 自然淡妆 + 增发蓬松 + 提气色，明显变好看但一眼是本人 | 职业照/证件照主用 |
| `medium` | 脸更小、妆更精致、眼更亮，仍是本人但偏写真精修 | 小红书/社交头像 |
| `off` | 纯还原，不做任何美化，最大化保真 | 强调真实、证件审核严格时 |

## 安装

```bash
./install.sh
```

或手动安装到 Claude Code：

```bash
cp -r . ~/.claude/skills/exec-headshot
cd ~/.claude/skills/exec-headshot && npm install --omit=dev
```

## 使用

在 Claude Code / Codex / OpenClaw 中说：

> 帮我生成一张高管风职业照（附上照片）

或直接命令行：

```bash
# 默认（light 轻美颜）
node scripts/generate.mjs --image ~/Desktop/selfie.jpg --style apple-executive
# 指定美颜档位 + 底色
node scripts/generate.mjs --image ~/Desktop/selfie.jpg --style standard-id --beautify medium --notes "蓝底"
# 纯还原，不美颜
node scripts/generate.mjs --image ~/Desktop/selfie.jpg --style korean-id --beautify off
node scripts/generate.mjs --list-styles
```

## 配置

首次使用会引导配置图像生成 API，写入 `~/.config/exec-headshot/config.json`：

```json
{
  "apiFormat": "chat 或 images",
  "apiKey": "你的 Key",
  "baseUrl": "https://...",
  "model": "图像编辑模型名",
  "defaultAspectRatio": "3:4"
}
```

支持两种端点格式：
- `chat`：OpenAI Chat Completions 兼容（带 `image_url` 的 messages），如 Google AI Studio 官方、各类第三方代理
- `images`：OpenAI `/v1/images/edits` 兼容（如 gpt-image 系模型）

推荐使用支持人像编辑的 Gemini 图像系列或 gpt-image-2。

## 出片质量小贴士

- 原照片正面或微侧、面部清晰、光线均匀，出片最像本人
- 同一风格生成 2-3 张（`--count 3`），挑相似度最高的
- 觉得「像又不像」→ 加 `--mirror`（生图模型常镜像人脸，翻转回来通常变像）
- 想更自然不美颜 → `--beautify off`；想更精致 → `--beautify medium`

## License

MIT © Vivi
