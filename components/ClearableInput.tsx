// components/ClearableInput.tsx
// 入力があるとき右端に×を出し、タップで即クリアする TextInput。
// iOS の clearButtonMode はアイコンが出ないことがあるため自前で描画する。
import { View, TextInput, TouchableOpacity, StyleSheet, TextInputProps, ViewStyle, StyleProp } from 'react-native';
import { IconX } from '@tabler/icons-react-native';

export default function ClearableInput({ value, onChangeText, style, ...rest }: TextInputProps) {
  return (
    <View style={[style as StyleProp<ViewStyle>, styles.wrap]}>
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} {...rest} />
      {value ? (
        <TouchableOpacity style={styles.clear} onPress={() => onChangeText?.('')} hitSlop={8}>
          <IconX size={14} color="#fff" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, padding: 0 },
  clear: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#c4c4c4', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
});
