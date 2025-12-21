import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:toilet_map_2/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const ToiletApp());

    // Verify that the app builds and shows the Material App.
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
