import { Action, ActionPanel, Icon, List } from "@raycast/api";
import SettingsForm from "../settings";
import type { RayAISettings } from "../types";

interface Props {
  onConfigured: (settings: RayAISettings) => void;
}

export function SettingsRequired({ onConfigured }: Props) {
  return (
    <List filtering={false} searchText="" onSearchTextChange={() => undefined}>
      <List.EmptyView
        icon={Icon.Gear}
        title="尚未完成配置"
        description="请先配置推理服务 URL 和至少一个模型。"
        actions={
          <ActionPanel>
            <Action.Push
              title="打开 RayAI 配置"
              icon={Icon.Gear}
              target={<SettingsForm onSaved={onConfigured} />}
            />
          </ActionPanel>
        }
      />
    </List>
  );
}
