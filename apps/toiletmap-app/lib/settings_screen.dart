import 'package:flutter/material.dart';
import 'util/logging.dart' as logging;
import 'util/map_util.dart';

class SettingScreen extends StatefulWidget {
  const SettingScreen({super.key});

  @override
  State<SettingScreen> createState() => _SettingScreenState();
}

class _SettingScreenState extends State<SettingScreen> {
  final Map<String, bool> _changed = {"slider": false, "filters": false};
  double mySearchRadius = MapUtil.instance.getSearchRadius();
  // Map<String, bool> myFeatures = MapUtil.instance.features.asMap().map(
  //   (_, feature) =>
  //       MapEntry(feature, MapUtil.instance.filters[feature] ?? false),
  // );

  @override
  Widget build(BuildContext context) {
    final List<Widget> widgetList = [];
    final searchRadiusTile = ListTile(
      title: Text("Search Radius: ${mySearchRadius.toInt()} meters"),
      subtitle: Slider(
        value: mySearchRadius,
        max: 5000,
        divisions: 100,
        //label: '${MapUtil.instance.getSearchRadius().toInt()} meters',
        onChanged: (double value) {
          setState(() {
            mySearchRadius = value;
            MapUtil.instance.setSearchRadius(value);
            MapUtil.instance.setSettingsChanged(true);
            _changed["slider"] = true;
          });
        },
      ),
    );
    widgetList.add(searchRadiusTile);
    widgetList.add(const Divider());

    // Map<String, bool> filters = myFeatures;
    Map<String, FilterItem> filters = MapUtil.instance.filterData;
    filters.forEach((key, value) {
      logging.log.info("Filter $key is set to ${value.getIsOn()}");
      widgetList.add(
        ListTile(
          enabled: value.getIsOn(),
          //selected: _selected,
          onTap: () {},
          leading: Icon(value.icon),
          title: Text(value.displayText),
          //subtitle: const Text('Set filters for toilet search results'),
          trailing: Switch(
            onChanged: (bool? newValue) {
              // This is called when the user toggles the switch.
              //myFeatures[key] = newValue ?? false;
              MapUtil.instance.filterData[key]?.setIsOn(newValue ?? false);
              MapUtil.instance.setSettingsChanged(true);
              setState(() {
                _changed["filters"] = true;
              });
            },
            value: value.getIsOn()
          ),
        ),
      );
      widgetList.add(const Divider());
    });

    return Scaffold(
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.onPrimary,
        foregroundColor: Theme.of(context).colorScheme.primary,
        title: const Text("Filters"),
        actions: <Widget>[
          TextButton(
            //icon: const Icon(Icons.save),
            onPressed: () {
              MapUtil.instance.setSearchRadius(2000.0);
              for (String filter in MapUtil.features) {
                MapUtil.instance.filterData[filter]?.setIsOn(true);
              }
              MapUtil.instance.setSettingsChanged(true);
              // String result = 'false';
              // if (_changed["slider"] == true || _changed["filters"] == true) {
              //   result = 'true';
              //   MapUtil.instance.setSearchRadius(mySearchRadius);
              //   // myFeatures.forEach((key, value) {
              //   //   MapUtil.instance.filters[key] = value;
              //   // });
              //   MapUtil.instance.setSettingsChanged(true);
              // }
              Navigator.pop(context, "true");
            },
            child: Column(children: [Icon(Icons.restore), Text("Default")]),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(0, 50, 0, 0),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: widgetList,
        ),
      ),
    );
  }
}
