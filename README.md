# RayAI

RayAI is a Raycast v2 extension for OpenAI-compatible inference services.

## Commands

- **AI 推理对话**: accepts questions in the native search bar, keeps context, and opens a full Markdown view while each answer streams.
- **AI 推理配置**: configures the inference URL, token, models, request parameters, and context lifetime.

## Fallback Command

To keep **AI 推理对话** visible for every root-search query, open Raycast Settings, go to
**Launcher > Fallback Commands**, choose **Add Fallback Command**, and add **AI 推理对话** from RayAI.
RayAI reads Raycast's fallback text directly and sends it as the initial prompt.

## Configuration

Use the **AI 推理配置** command first. The service URL may be either a version root such as
`https://api.openai.com/v1` or the complete `/chat/completions` endpoint.

Add models from the configuration form's action panel. Each model has an ID, display name, and an
explicit **supports image input** option. Models can also be edited or removed from the same action
panel.

Additional request parameters are merged into the Chat Completions request. RayAI always controls
`model`, `messages`, and `stream`.

## Native UI Note

Raycast's extension API does not expose arbitrary chat-bubble layout or a bottom-docked composer.
RayAI therefore uses a normal list with Raycast's native search bar and opens the current answer in
a full-width Markdown detail view.

## License

RayAI is licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).
