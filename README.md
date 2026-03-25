# Migi（ミギ）

> あなたの右腕として動く AI エージェント CLI
> Powered by OpenAI API — by MAKE U FREE

---

## 全体アーキテクチャ

```mermaid
graph TD
  subgraph bin
    B[migi.js エントリーポイント]
  end

  subgraph src
    S[setup.js セットアップ]
    O[onboarding.js ワークスペース初期化]
    C[context.js コンテキスト読み込み]
    SK[skills.js スキルルーティング]
    A[agent.js 会話ループ]
    T[tools.js ファイル操作・コマンド実行]
    P[permissions.js 許可制]
  end

  subgraph fs
    CFG[config.json APIキー・名前・モデル]
    MEM[memory.md グローバルメモリ]
    MIGIMD[MIGI.md ワークスペース設定]
    SKILLS[skills/ スキルファイル]
    TPL[templates/ 初期化テンプレート]
  end

  OAI[OpenAI API]

  B --> S
  B --> O
  B --> C
  B --> SK
  B --> A
  S --> CFG
  O --> TPL
  O --> MIGIMD
  C --> MEM
  C --> MIGIMD
  SK --> SKILLS
  A --> OAI
  A --> T
  A --> P
```

---

## 起動フロー

```mermaid
graph TD
  Start([migi 起動]) --> CheckCfg{config.json があるか}

  CheckCfg -->|なし| InputKey[APIキー入力]
  InputKey --> SelectModel[モデル選択]
  SelectModel --> InputName[名前入力]
  InputName --> AIName[AIが名前を解釈]
  AIName --> SaveCfg[config.json に保存]
  SaveCfg --> CheckWS

  CheckCfg -->|あり| LoadCfg[設定読み込み]
  LoadCfg --> CheckWS

  CheckWS{MIGI.md または .company があるか}
  CheckWS -->|なし| Q1[Q1 事業・活動を教えて]
  Q1 --> Q2[Q2 目標・困りごとを教えて]
  Q2 --> GenFiles[.company/ を生成]
  GenFiles --> LoadCtx

  CheckWS -->|あり| LoadCtx[コンテキスト読み込み]
  LoadCtx --> Ready([メインループ開始])
```

---

## リクエスト処理フロー

```mermaid
sequenceDiagram
  actor User
  participant CLI as migi.js
  participant Agent as agent.js
  participant OpenAI
  participant Tools as tools.js
  participant FS as ファイルシステム

  User->>CLI: テキスト入力

  alt スキルコマンド
    CLI->>CLI: スキルファイルを検索
    CLI->>Agent: スキル内容＋入力を展開して送信
  else 通常テキスト
    CLI->>Agent: そのまま送信
  end

  Agent->>OpenAI: messages＋tool定義を送信

  loop ツール呼び出しがある間
    OpenAI-->>Agent: tool_calls レスポンス

    alt 読み取り系 自動承認
      Agent->>Tools: 即実行
    else 書き込み・実行系 要確認
      Agent->>User: 実行しますか y/N
      User->>Agent: 承認 or 拒否
      Agent->>Tools: 承認なら実行
    end

    Tools->>FS: ファイル操作 or コマンド実行
    FS-->>Tools: 結果
    Tools-->>Agent: 結果を返す
    Agent->>OpenAI: tool results を送信
  end

  OpenAI-->>Agent: 最終回答
  Agent-->>User: 返答を表示
```

---

## コンテキスト読み込みの優先順位

```mermaid
graph LR
  A[memory.md グローバル] --> B[memory.md ワークスペース]
  B --> C[MIGI.md ルート]
  C --> D[.company/MIGI.md]
  D -->|なければ| E[.company/CLAUDE.md]
  D --> F[secretary/MIGI.md]
  F --> G[その他部署/MIGI.md]
```

---

## スキルシステム

```mermaid
graph TD
  Input[入力 /secretary など] --> Parse[コマンド名を抽出]
  Parse --> Search1[.migi/skills/ を探す ユーザー定義]
  Search1 -->|あり| Load[スキルファイルを読み込む]
  Search1 -->|なし| Search2[skills/ を探す ビルトイン]
  Search2 -->|あり| Load
  Search2 -->|なし| NotFound[スキルが見つかりません]
  Load --> Expand[スキル内容＋引数を展開]
  Expand --> Agent[エージェントに送信]
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

# ユーザーのワークスペース
{cwd}/
├── MIGI.md               # ワークスペース設定（なければ CLAUDE.md）
├── todos/
│   └── YYYY-MM-DD.md
└── .company/
    ├── MIGI.md
    └── secretary/
        ├── MIGI.md
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
