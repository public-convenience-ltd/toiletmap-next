import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

ColorScheme getColorScheme(BuildContext context) {
  return ColorScheme.fromSeed(
    seedColor: Color(0xFF0A165A),
    brightness: Brightness.light, // MediaQuery.platformBrightnessOf(context),
    contrastLevel: 0.0,
    primary: Color(0xFF0A165A),
    dynamicSchemeVariant: DynamicSchemeVariant.fidelity,
  );
}

ThemeData getMainTheme(BuildContext context) {
  return ThemeData(
    colorScheme: getColorScheme(context),
    iconTheme: IconThemeData(color: Color(0xffed3d62)),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: Theme.of(context).colorScheme.onPrimary,
      foregroundColor: Theme.of(context).colorScheme.primary,
    ),
    textTheme: GoogleFonts.openSansTextTheme(),
  );
}
