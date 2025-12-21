import 'package:flutter/material.dart';

import 'first_page.dart';
import 'second_page.dart';
import 'third_page.dart';

class BottomNavigationBarController extends StatefulWidget {
  const BottomNavigationBarController({super.key});

  @override
  BottomNavigationBarControllerState createState() =>
      BottomNavigationBarControllerState();
}

class BottomNavigationBarControllerState
    extends State<BottomNavigationBarController> {
  final List<Widget> pages = [
    FirstPage(key: PageStorageKey('Page1'), title: 'Nearby Toilets'),
    SavedLocationsScreen(
      key: PageStorageKey('Page3'),
      title: 'Saved Locations',
    ),
    SearchScreen(key: PageStorageKey('Page2'), title: 'Search for Toilets'),
  ];

  final PageStorageBucket bucket = PageStorageBucket();

  int _selectedIndex = 0;

  Widget _bottomNavigationBar(int selectedIndex) => BottomNavigationBar(
    onTap: (int index) => setState(() => _selectedIndex = index),
    currentIndex: selectedIndex,
    selectedItemColor: Theme.of(context).colorScheme.primary,
    unselectedItemColor: Theme.of(context).colorScheme.inversePrimary,
    backgroundColor: Theme.of(context).colorScheme.onPrimary,
    items: const <BottomNavigationBarItem>[
      BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Nearby Toilets'),
      BottomNavigationBarItem(icon: Icon(Icons.save), label: 'Saved Locations'),
      BottomNavigationBarItem(icon: Icon(Icons.search), label: 'Search'),
    ],
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      //appBar: AppBar(title: svg),
      bottomNavigationBar: _bottomNavigationBar(_selectedIndex),
      body: PageStorage(bucket: bucket, child: pages[_selectedIndex]),
    );
  }
}
