# Migi（ミギ）

> あなたの右腕として動く AI エージェント CLI
> Powered by OpenAI API — by MAKE U FREE

---

## 全体アーキテクチャ

```mermaid
flowchart TD
  subgraph bin ["bin/"]
    B["migi.js - エントリーポイント"]
  end

  subgraph src ["src/"]
    S["setup.js - 初回セットアップ"]
    O["onboarding.js - ワークスペース初期化"]
    C["context.js - コンテキスト読み込み"]
    SK["skills.js - スキルルーティング"]
    A["agent.js - 会話ループ"]
    T["tools.js - ファイル操作・コマンド実行"]
    P["permissions.js - 許可制システム"]
  end

  subgraph external ["外部"]
    OAI["OpenAI API"]
  end

  subgraph fs ["ファイルシステム"]
    CFG["~/.migi/config.json - APIキー・名前・モデル"]
    MEM["~/.migi/memory.md - グローバルメモリ"]
    MIGIMD[".company/MIGI.md - ワークスペース設定"]
    SKILLS["skills/*.md - スキルファイル"]
    TPL["templates/ - 初期化テンプレート"]
  end

  B --> S & O & C & SK & A
  S --> CFG
  O --> TPL & MIGIMD
  C --> MEM & MIGIMD
  SK --> SKILLS
  A --> OAI & T & P
```

---

## 起動フロー

```mermaid
flowchart TD
  Start([migi 起動]) --> CheckCfg{"~/.migi/config.json\nがあるか？"}

  CheckCfg -->|なし| Setup["セットアップウィザード"]
  Setup --> InputKey["① APIキー入力"]
  InputKey --> SelectModel["② モデル選択\ngpt-4o / gpt-4o-mini / カスタム"]
  SelectModel --> InputName["③ 名前入力"]
  InputName --> AIName["AIが名前を解釈\n例: みぎにしよう → みぎ"]
  AIName --> SaveCfg["config.json に保存"]
  SaveCfg --> CheckWS

  CheckCfg -->|あり| LoadCfg["設定読み込み\nAPIキー・モデル・名前"]
  LoadCfg --> CheckWS

  CheckWS{"MIGI.md または\n.company/ があるか？"}
  CheckWS -->|なし| Onboarding["オンボーディング"]
  Onboarding --> Q1["Q1: 事業・活動を教えて"]
  Q1 --> Q2["Q2: 目標・困りごとを教えて"]
  Q2 --> GenFiles[".company/MIGI.md\nsecretary/MIGI.md\ntodos/今日.md を生成"]
  GenFiles --> LoadCtx

  CheckWS -->|あり| LoadCtx["コンテキスト読み込み"]
  LoadCtx --> ReadFiles["MIGI.md を優先して読み込み\nなければ CLAUDE.md にフォールバック"]
  ReadFiles --> Ready(["メインループ開始"])
```

---

## リクエスト処理フロー

```mermaid
sequenceDiagram
  actor User
  participant CLI as bin/migi.js
  participant Agent as agent.js
  participant OpenAI
  participant Tools as tools.js
  participant FS as ファイルシステム

  User->>CLI: テキスト入力

  alt スキルコマンド /secretary など
    CLI->>CLI: スキルファイルを検索
    CLI->>Agent: スキル内容＋入力を展開して送信
  else 通常テキスト
    CLI->>Agent: そのまま送信
  end

  Agent->>OpenAI: messages＋tool定義を送信

  loop ツール呼び出しがある間
    OpenAI-->>Agent: tool_calls レスポンス

    alt 読み取り系ツール（自動承認）
      Note over Agent: read_file / list_files / search_content
      Agent->>Tools: 即実行
    else 書き込み・実行系ツール（要確認）
      Note over Agent: write_file / append_file / execute_command
      Agent->>User: 実行しますか？ y/N
      User->>Agent: 承認 or 拒否
      Agent->>Tools: 承認なら実行
    end

    Tools->>FS: ファイル操作 or コマンド実行
    FS-->>Tools: 結果
    Tools-->>Agent: 結果を返す
    Agent->>OpenAI: tool results を送信
  end

  OpenAI-->>Agent: stop（最終回答）
  Agent-->>User: 返答を表示
```

---

## コンテキスト読み込みの優先順位

```mermaid
flowchart LR
  subgraph global ["グローバル（優先）"]
    A["~/.migi/memory.md"]
    B[".migi/memory.md"]
    C["MIGI.md（ルート）"]
  end

  subgraph company [".company/ 以下"]
    D["MIGI.md（優先）"]
    E["CLAUDE.md（フォールバック）"]
    F["secretary/MIGI.md"]
    G["その他部署/MIGI.md"]
  end

  A --> B --> C --> D
  D -->|なければ| E
  D --> F --> G
```

---

## スキルシステム

```mermaid
flowchart TD
  Input["入力: /secretary など"] --> Parse["コマンド名を抽出"]
  Parse --> Search1[".migi/skills/secretary.md を探す\nユーザー定義"]
  Search1 -->|あり| Load["スキルファイルを読み込む"]
  Search1 -->|なし| Search2["skills/secretary.md を探す\nビルトイン"]
  Search2 -->|あり| Load
  Search2 -->|なし| NotFound["スキルが見つかりません"]
  Load --> Expand["スキル内容＋ユーザー引数を展開"]
  Expand --> Agent["エージェントに送信"]
```

---

## ファイル構成

```
migi/
├── bin/
│   └── migi.js           # エントリーポイント・メインループ
├── src/
│   ├── agent.js          # OpenAI 会話ループ・ツール呼び出し制御
│   ├── context.js        # MIGI.md / memory.md の読み込み
│   ├── onboarding.js     # 空ワークスペースの初期化ウィザード
│   ├── permissions.js    # 書き込み・実行の許可制
│   ├── setup.js          # APIキー・モデル・名前のセットアップ
│   ├── skills.js         # /コマンドのスキルルーティング
│   └── tools.js          # ファイル操作・コマンド実行ツール
├── skills/
│   └── secretary.md      # ビルトインスキル（秘書モード）
├── templates/
│   ├── company-migi.md   # .company/MIGI.md のテンプレート
│   └── secretary-migi.md # secretary/MIGI.md のテンプレート
└── package.json

# ユーザーのワークスペース（起動ディレクトリ）
{cwd}/
├── MIGI.md               # ワークスペース設定（なければ CLAUDE.md）
├── todos/
│   └── YYYY-MM-DD.md    # 日次TODO
└── .company/
    ├── MIGI.md           # 組織設定
    └── secretary/
        ├── MIGI.md       # 秘書ルール
        ├── inbox/
        └── notes/

# グローバル設定
~/.migi/
├── config.json           # APIキー・モデル・名前
└── memory.md             # 全ワークスペース共通メモリ
```

---

## セットアップ

```bash
git clone https://github.com/kazuhiro-yourself/migi.git
cd migi
npm install

# 作業ディレクトリで起動（初回は自動セットアップ）
cd ~/your-workspace
node /path/to/migi/bin/migi.js
```

## 使い方

```
> 今日のTODO見せて     # 普通に話しかけるだけ
> /secretary           # 秘書モードを明示的に起動
> /config              # 設定変更
> /exit                # 終了
```
