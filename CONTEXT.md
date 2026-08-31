# Colorack / Kitrack Domain Language

Colorack manages paint information and Kitrack manages model-kit purchase intentions, owned kits, and the colors used on them. Similar-looking records remain separate when their lifecycle and ownership differ.

## Kitrack

**購入候補**:
A model kit the user is considering buying. It has no Box or production status and is removed from the shopping list when converted into an owned kit.
_Avoid_: 買い物リストの所有キット、未着手キット

**所有キット**:
One physical kit owned by the user. Each record represents one copy and has its own Box, production status, photos, and used colors.
_Avoid_: 購入候補、買い物リスト項目

**キットBox**:
A storage grouping for owned kits. Purchase candidates never belong to a Kit Box.
_Avoid_: 買い物リスト、購入候補の保存先
