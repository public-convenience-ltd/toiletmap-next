import 'package:envied/envied.dart';

part 'env.g.dart';

@Envied(path: '.env')
final class Env {
  @EnviedField(obfuscate: true)
  static final String orsKey = _Env.orsKey;
}
