import { Redirect } from "expo-router";

// ルート "/" を最初のタブへ。(tabs) グループ内に index が無いため必要。
export default function Index() {
  return <Redirect href="/owned" />;
}
