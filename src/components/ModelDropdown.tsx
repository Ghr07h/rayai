import { List } from "@raycast/api";
import type { ModelConfig } from "../types";

interface Props {
  models: ModelConfig[];
  value: string;
  onChange: (model: string) => void;
}

export function ModelDropdown({ models, value, onChange }: Props) {
  const selectedModel = models.find((model) => model.id === value);
  const displayedModels = selectedModel
    ? [selectedModel, ...models.filter((model) => model.id !== value)]
    : models;

  return (
    <List.Dropdown tooltip="选择模型" value={value} onChange={onChange}>
      {displayedModels.map((model) => (
        <List.Dropdown.Item
          key={model.id}
          title={model.name}
          value={model.id}
        />
      ))}
    </List.Dropdown>
  );
}
