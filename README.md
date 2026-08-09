# slack-patron-mcp

slack-patron (https://github.com/tsg-ut/slack-patron) のSlackメッセージ履歴APIをClaudeから利用するためのリモートMCPサーバー。

## 概要

- **トランスポート**: Streamable HTTP (stateless)
- **認証**: Bearer token (MCP_SERVER_AUTH_TOKEN)、および **OAuth 2.1 (with PKCE)**（Claude.ai カスタムコネクタ接続用）
- **上流API**: `SLACK_PATRON_BASE_URL` 環境変数で設定

## 利用可能なツール

| ツール名 | 説明 |
|---------|------|
| `list_channels` | ワークスペースの全チャンネル一覧を取得 |
| `list_users` | ワークスペースの全ユーザー一覧を取得 |
| `get_user_info` | 特定ユーザーの詳細情報を取得 (ID またはユーザー名/表示名で検索) |
| `get_channel_messages` | チャンネルのメッセージ履歴を取得 (時系列順、時刻範囲・ページネーション対応、添付ファイルは末尾に注記) |
| `get_channel_messages_raw` | チャンネルのメッセージ履歴を生JSON形式で取得 |
| `get_thread_replies` | スレッドの返信一覧を取得 (添付ファイルは末尾に注記) |
| `get_thread_replies_raw` | スレッドの返信一覧を生JSON形式で取得 |
| `search_messages` | ElasticSearchクエリ文字列構文でメッセージを検索 |
| `download_file` | SlackにアップロードされたファイルをダウンロードしてコンテンツをSlack API経由で取得 |

### `get_user_info` パラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `user` | string | ✓ | Slack ユーザーID (例: U01234567) またはユーザー名/表示名 (例: taro, @taro) |

### `get_channel_messages` パラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `channel` | string | ✓ | チャンネルID (C01234567) またはチャンネル名 (general, #general) |
| `limit` | number | - | 取得件数 (1-200, デフォルト50) |
| `oldest` | string | - | 開始タイムスタンプ (例: 1700000000.000000) |
| `latest` | string | - | 終了タイムスタンプ |
| `cursor` | string | - | ページネーションカーソル (前回レスポンスから取得) |
| `order` | `"asc"` \| `"desc"` | - | 表示順。`asc` (デフォルト) は古い順、`desc` は新しい順 |

`order` はページ内の**表示順**のみを変更します。取得されるのは常に指定範囲の最新側から `limit` 件であり、`cursor` は常により古い方向へ進みます。そのため `order: "asc"` の場合、カーソルの案内文はメッセージ一覧の**先頭**に出力されます。

### `get_thread_replies` パラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `channel` | string | ✓ | チャンネルID |
| `thread_ts` | string | ✓ | 親メッセージのタイムスタンプ |
| `limit` | number | - | 取得件数 (1-200, デフォルト50) |
| `cursor` | string | - | ページネーションカーソル |

`get_channel_messages` / `get_thread_replies` は、メッセージに添付ファイルがある場合、行の末尾に注記を追加します。全ファイルが画像の場合は `添付画像あり`、それ以外を含む場合は `添付ファイルあり` と表示されます。

```
[2023-11-14T22:13:20.000Z] <U001>: look at this [添付画像あり(2件): https://example.com/example.jpg / fileId:F01234567, https://example.com/example2.png / fileId:F09876543]
```

### `search_messages` パラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `query` | string | ✓ | ElasticSearchクエリ文字列。例: `プログラム AND (channel:C7AAX50QY) AND (user:U04G7TL4P) AND (ts:[* TO 1780239600])` |
| `limit` | number | - | 取得件数 (1-100, デフォルト20) |
| `cursor` | string | - | ページネーションカーソル (前回レスポンスから取得) |

### `download_file` パラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `file_id` | string | ✓ | Slack ファイルID (例: F1234567890) |

テキストファイル (text/*, application/json 等) はプレーンテキストとして返します。バイナリファイルはBase64エンコードして返します。5 MB を超えるファイルはダウンロードせず、メタデータのみ返します。

## セットアップ

### 必要な環境変数

| 変数名 | 説明 |
|-------|------|
| `MCP_SERVER_AUTH_TOKEN` | Claudeがこのサーバーに接続する際のBearerトークン |
| `SLACK_PATRON_API_TOKEN` | slack-patronの上流APIへのBearerトークン |
| `SLACK_PATRON_BASE_URL` | slack-patron上流APIのベースURL (末尾スラッシュなし) |
| `SLACK_TOKEN` | Slack APIトークン (`download_file` で使用。`files:read` スコープが必要) |
| `USERS_JSON_PATH` | ユーザーID→表示名マッピングのJSONファイルパス (省略時はIDをそのまま表示) |
| `PORT` | サーバーポート (デフォルト: 29112) |

### ローカル開発

```bash
# 依存関係インストール
npm install

# 環境変数設定
cp .env.example .env
# .env を編集して実際の値を設定

# 開発サーバー起動 (ホットリロード付き)
npm run dev

# ビルド
npm run build

# テスト
npm test
```

### Nginx設定

```bash
# 設定ファイルをコピー (nginx/ ディレクトリは .gitignore 対象のため各自作成)
sudo cp nginx/your-vhost-config /etc/nginx/sites-available/

# シンボリックリンク作成
sudo ln -s /etc/nginx/sites-available/your-vhost-config \
           /etc/nginx/sites-enabled/your-vhost-config

# 設定確認と再読み込み
sudo nginx -t && sudo systemctl reload nginx
```

## Claude.ai / Claude Code コネクタ登録方法

### 1. Claude.ai (Web UI) で登録する場合 (OAuth 2.1)
Claude.ai (Enterprise または Pro) のカスタムコネクタとして登録する手順は以下の通りです。

#### 1-1. コネクタの追加
1. Claude.ai の管理画面（「Organization Settings」 > 「Connectors」等）で、**「Add custom connector」** を選択します。
2. サーバーのベースURL（例: `https://your-server.example.com`）を入力します。
   - ※ Claude.ai からアクセスできるよう、公開URLであり HTTPS で保護されている必要があります。
3. 認証方法（Authentication）として **「OAuth 2.0」** を選択します。

#### 1-2. クライアント情報の設定
1. **Client ID** / **Client Secret**: 任意のダミーの文字列を入力します（例: Client IDに `claude-client` など）。
   - ※ 本サーバーはシングルユーザー向けであるため、厳格な Client ID 制限は行わず、PKCE検証と設定されたパスワードによる認証のみで動作します。
2. メタデータの自動検出により、サーバーから提供される各種認証・トークンエンドポイント (`/.well-known/oauth-authorization-server` など) が自動的に適用されます。

#### 1-3. 同意画面での認可
1. コネクタを有効化する際、Claude から本サーバーの認可画面（`/oauth/authorize`）にリダイレクトされます。
2. パスワード入力欄が表示されるため、サーバーの環境変数 `MCP_SERVER_AUTH_TOKEN` に設定されている **Bearer Token (パスワード)** を入力し、**「アクセスを認可する」** ボタンをクリックします。
3. 認証に成功すると、自動的に Claude 側にリダイレクトされ、接続が完了します。以降、1年間有効な JWT アクセストークンが Claude に払い出され、本サーバーへの通信が認証されます。

### 2. Claude Code で登録する場合 (固定Bearerトークン)
Claude Code などの CLI ツールでは、ヘッダーに直接固定トークンを設定して接続できます。
`~/.claude/settings.json` に以下のように設定してください。

```json
{
  "mcpServers": {
    "slack-patron": {
      "type": "http",
      "url": "https://your-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_SERVER_AUTH_TOKEN"
      }
    }
  }
}
```

## 動作確認 curl コマンド

MCP の Streamable HTTP トランスポートでは `Accept: application/json, text/event-stream` ヘッダーが必須です (Claude クライアントは自動付与するが、curl では明示指定が必要)。

```bash
export TOKEN="your-mcp-server-auth-token"
export BASE="https://your-server.example.com"
# MCP リクエスト共通ヘッダー
MCP_HEADERS=('-H' 'Content-Type: application/json' '-H' 'Accept: application/json, text/event-stream')

# ヘルスチェック (認証不要)
curl "${BASE}/health"

# 認証失敗の確認
curl -X POST "${BASE}/mcp" \
  "${MCP_HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# → 401 Unauthorized

# ツール一覧
curl -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${TOKEN}" \
  "${MCP_HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# チャンネル一覧取得
curl -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${TOKEN}" \
  "${MCP_HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_channels","arguments":{}}}'

# メッセージ取得 (チャンネル名指定)
curl -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${TOKEN}" \
  "${MCP_HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_channel_messages","arguments":{"channel":"general","limit":10}}}'

# スレッド返信取得
curl -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${TOKEN}" \
  "${MCP_HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_thread_replies","arguments":{"channel":"C01234567","thread_ts":"1700000000.123456"}}}'
```

## セキュリティ

- 全シークレットは環境変数経由で管理 (コードにハードコードしない)
- MCP認証はBearerトークン + タイミング安全比較 (`crypto.timingSafeEqual`)
- ログにトークンやメッセージ内容を出力しない
- 上流APIエラー時はHTTPステータスコードのみ通知 (スタックトレース非公開)
- slack-patronへのリクエストは常に `limit` を指定し大量取得を防止
- 書き込み系操作は一切実装しない (読み取り専用)
