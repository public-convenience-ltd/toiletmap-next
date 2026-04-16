import 'package:logging/logging.dart';

final log = Logger('ToiletMapLogger');

void setupLogging() {
  Logger.root.level = Level.ALL; // Set the logging level to ALL
  Logger.root.onRecord.listen((record) {
    //print('${record.level.name}: ${record.time}: ${record.message}');
  });
}
