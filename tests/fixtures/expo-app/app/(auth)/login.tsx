import { View, Text } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { router } from 'expo-router';

export default function Login() {
  const { login } = useAuth();

  const handleLogin = async () => {
    await login();
    router.push('/(tabs)/home');
  };

  return (
    <View>
      <Text>Login</Text>
    </View>
  );
}
