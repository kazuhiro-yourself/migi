# Migi（ミギ）

> あなたの右腕として動く AI エージェント CLI
> Powered by OpenAI API — by MAKE U FREE

---

## 全体アーキテクチャ

```mermaid
graph TD
  subgraph bin
    B[bin/migi.js<br/>エントリーポイント]
  end

  subgraph src
    S[setup.js<br/>初回セットアップ]
    O[onboarding.js<br/>ワークスペース初期化]
    C[context.js<br/>コンテキスト読み込み]
    SK[skills.js<br/>スキルルーティング]
    A[agent.js<br/>会話ループ]
    T[tools.js<br/>ファイル操作・コマンド実行]
    P[permissions.js<br/>許可制システム]
  end

  subgraph external
    OAI[OpenAI API]
  end

  subgraph filesystem
    CFG[~/.migi/config.json<br/>APIキー・名前・モデル]
    MEM[~/.migi/memory.md<br/>グローバルメモリ]
    MIGIMD[.company/MIGI.md<br/>ワークスペース設定]
    SKILLS[skills/*.md<br/>スキルファイル]
    TPL[templates/<br/>初期化テンプレート]
  end

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
flowchart TD
  Start([migi 起動]) --> CheckCfg{~/.migi/config.json\nがあるか？}

  CheckCfg -->|なし| Setup[セットアップウィザード]
  Setup --> InputKey[① APIキー入力]
  InputKey --> SelectModel[② モデル選択\ngpt-4o / gpt-4o-mini / カスタム]
  SelectModel --> InputName[③ 名前入力]
  InputName --> AIName[AIが名前を解釈\n「みぎにしよう！」→「みぎ」]
  AIName --> SaveCfg[config.json に保存]
  SaveCfg --> CheckWS

  CheckCfg -->|あり| LoadCfg[設定読み込み\nAPIキー・モデル・名前]
  LoadCfg --> CheckWS

  CheckWS{.company/ または\nMIGI.md があるか？}
  CheckWS -->|なし| Onboarding[オンボーディング]
  Onboarding --> Q1[Q1: 事業・活動を教えて]
  Q1 --> Q2[Q2: 目標・困りごとを教えて]
  Q2 --> GenFiles[ファイル生成\n.company/MIGI.md\nsecretary/MIGI.md\ntodos/今日.md]
  GenFiles --> LoadCtx

  CheckWS -->|あり| LoadCtx[コンテキスト読み込み]
  LoadCtx --> ReadFiles["MIGI.md / CLAUDE.md を優先順に読む\n① ~/.migi/memory.md\n② MIGI.md or CLAUDE.md\n③ .company/**/MIGI.md"]
  ReadFiles --> Ready([メインループ開始])
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

  alt /コマンド形式
    CLI->>CLI: スキルファイルを検索\n(.migi/skills/ → skills/)
    CLI->>Agent: スキル内容 + ユーザー入力を展開して送信
  else 通常テキスト
    CLI->>Agent: そのまま送信
  end

  Agent->>OpenAI: messages + tool定義を送信

  loop ツール呼び出しがある間
    OpenAI-->>Agent: tool_calls レスポンス

    alt 読み取り系ツール（自動承認）
      Note over Agent: read_file / list_files / search_content
      Agent->>Tools: 即実行
    else 書き込み・実行系ツール（要確認）
      Note over Agent: write_file / append_file / execute_command
      Agent->>CLI: 「実行しますか？[y/N]」
      CLI->>User: 確認を求める
      User->>CLI: y / n
      CLI->>Agent: 承認 or 拒否
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
  subgraph 優先度「高」
    A[~/.migi/memory.md\nグローバルメモリ]
    B[.migi/memory.md\nワークスペースメモリ]
    C[MIGI.md\nルート設定]
  end

  subgraph .company/ 以下
    D[MIGI.md ← 優先]
    E[CLAUDE.md ← フォールバック]
    F[secretary/MIGI.md\n秘書ルール]
    G[その他部署/MIGI.md]
  end

  A --> B --> C --> D
  D -->|なければ| E
  D --> F --> G
```

---

## スキルシステム

```mermaid
flowchart TD
  Input["/secretary などの入力"] --> Parse[コマンド名を抽出]
  Parse --> Search1[.migi/skills/secretary.md\nを探す]
  Search1 -->|あり| Load[スキルファイルを読み込む]
  Search1 -->|なし| Search2[skills/secretary.md\nビルトインを探す]
  Search2 -->|あり| Load
  Search2 -->|なし| NotFound[スキルが見つかりません]
  Load --> Expand[スキル内容 + ユーザー引数を展開]
  Expand --> Agent[エージェントに送信]
```

---

## ファイル構成

```
migi/
├── bin/
│   └── migi.js          # エントリーポイント・メインループ
├── src/
│   ├── agent.js         # OpenAI 会話ループ・ツール呼び出し制御
│   ├── context.js       # MIGI.md / memory.md の読み込み
│   ├── onboarding.js    # 空ワークスペースの初期化ウィザード
│   ├── permissions.js   # 書き込み・実行の許可制
│   ├── setup.js         # APIキー・モデル・名前のセットアップ
│   ├── skills.js        # /コマンドのスキルルーティング
│   └── tools.js         # ファイル操作・コマンド実行ツール
├── skills/
│   └── secretary.md     # ビルトインスキル（秘書モード）
├── templates/
│   ├── company-migi.md  # .company/MIGI.md のテンプレート
│   └── secretary-migi.md# secretary/MIGI.md のテンプレート
└── package.json

# ユーザーのワークスペース（起動ディレクトリ）
{cwd}/
├── MIGI.md              # ワークスペース設定（なければ CLAUDE.md）
├── todos/
│   └── YYYY-MM-DD.md   # 日次TODO
└── .company/
    ├── MIGI.md          # 組織設定
    └── secretary/
        ├── MIGI.md      # 秘書ルール
        ├── inbox/
        └── notes/

# グローバル設定（ユーザーホーム）
~/.migi/
├── config.json          # APIキー・モデル・名前
└── memory.md            # 全ワークスペース共通メモリ
```

---

## セットアップ

```bash
git clone https://github.com/your-org/migi.git
cd migi
npm install

# 作業ディレクトリで起動（初回は自動セットアップ）
cd ~/your-workspace
node /path/to/migi/bin/migi.js
```

## 使い方

```
> 今日のTODO見せて        # 普通に話しかけるだけ
> /secretary              # 秘書モードを明示的に起動
> /config                 # 設定変更
> /exit                   # 終了
```
