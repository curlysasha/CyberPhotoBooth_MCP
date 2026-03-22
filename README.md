# Budka MCP

MCP сервер для генерации изображений через [CyberPhotoBooth API](https://cyberphotobooth.ru) (модель Flux Klein).

## Инструменты

- **get_aspect_ratios** — список доступных соотношений сторон
- **create_prompt** — помощь в написании промпта для генерации
- **generate_image** — генерация изображения по промпту

## Установка

```bash
git clone <repo>
cd Budka_MCP
npm install
npm run build
```

## Подключение к Claude Code

### Для одного проекта

Создай `.mcp.json` в корне нужного проекта:

```json
{
  "mcpServers": {
    "budka": {
      "command": "node",
      "args": ["C:\\путь\\до\\Budka_MCP\\dist\\index.js"],
      "env": {
        "BUDKA_API_KEY": "твой-api-ключ"
      }
    }
  }
}
```

> В WSL путь будет `/mnt/c/...`, на Windows — `C:\...`

Перезапусти Claude Code — сервер подключится автоматически.

### Глобально (для всех проектов)

Через CLI команду:

```bash
claude mcp add budka --scope user -e BUDKA_API_KEY=твой-api-ключ -- node /путь/до/Budka_MCP/dist/index.js
```

Конфиг сохранится в `~/.claude.json` и сервер будет доступен в любом проекте.

Управление:

```bash
claude mcp list          # список серверов
claude mcp remove budka  # удалить
```
