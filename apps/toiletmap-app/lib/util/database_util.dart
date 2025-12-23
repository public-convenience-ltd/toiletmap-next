import 'dart:convert';

import 'package:latlong2/latlong.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'package:toilet_map_2/model/loos_by_proximity.dart';

import '../model/osm_data.dart';
import 'logging.dart' as logging;

class ToiletDatabase {
  static final _databaseName = "toilet_database.db";
  static final _databaseVersion = 1;

  static Database? _database;

  ToiletDatabase._();
  static final ToiletDatabase _instance = ToiletDatabase._();

  factory ToiletDatabase() {
    return _instance;
  }

  ToiletDatabase get instance => _instance;

  Future<Database> get db async {
    return _database ??= await _init();
  }

  Future<Database> _init() async {
    String dbName = join(await getDatabasesPath(), _databaseName);
    logging.log.info("Opening database at $dbName");
    final database = openDatabase(
      // Set the path to the database. Note: Using the `join` function from the
      // `path` package is best practice to ensure the path is correctly
      // constructed for each platform.
      dbName,
      // When the database is first created, create a table to store dogs.
      onCreate: (db, version) async {
        logging.log.info("Creating database with version $version");
        // Run the CREATE TABLE statement on the database.
        await db.execute(
          'CREATE TABLE location(id INTEGER PRIMARY KEY, address TEXT UNIQUE, latitude REAL, longitude REAL )',
        );
        await db.execute(
          'CREATE INDEX IF NOT EXISTS idx_location_address ON location(address)',
        );
        return db.execute(
          'CREATE TABLE location_loos(id INTEGER PRIMARY KEY, location_id INTEGER, loos TEXT, FOREIGN KEY(location_id) REFERENCES location(id) ON DELETE CASCADE)',
        );
      },
      // Set the version. This executes the onCreate function and provides a
      // path to perform database upgrades and downgrades.
      version: _databaseVersion,
    );
    return database;
  }

  Future<int> addLocation(OsmData loc, {String? loos}) async {
    var client = await db;
    if (loc.id != 0) {
      // If the location already has an ID, update it instead of inserting
      await updateLocation(loc);
      logging.log.info("Updated existing location with id: ${loc.id}");
      return loc.id;
    }
    loc.id = await client.insert(
      'location',
      loc.toMapForDb(),
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
    int locationLoosId = await client.insert('location_loos', {
      'location_id': loc.id,
      'loos': loos ?? '',
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    logging.log.info(
      "Inserted new location with id: ${loc.id} and loos id: $locationLoosId",
    );
    return loc.id;
  }

  Future<LoosByProximity?> fetchLocationLoos(int locationId) async {
    var client = await db;

    final Future<List<Map<String, dynamic>>> futureMaps = client.query(
      'location_loos',
      where: 'location_id = ?',
      whereArgs: [locationId],
    );
    var maps = await futureMaps;
    if (maps.isNotEmpty) {
      String jsonLoos = maps.first['loos'] as String;
      logging.log.info("jsonLoos is $jsonLoos");
      logging.log.info("Fetched loos for location id $locationId");
      Map<String, dynamic> json = jsonDecode(jsonLoos);
      logging.log.info("Decoded json: $json");
      return LoosByProximity.fromJson(json);
    }
    return null;
  }

  Future<OsmData?> fetchLocation(int id) async {
    var client = await db;

    final Future<List<Map<String, dynamic>>> futureMaps = client.query(
      'location',
      where: 'id = ?',
      whereArgs: [id],
    );
    var maps = await futureMaps;
    if (maps.isNotEmpty) {
      return OsmData.fromDb(maps.first);
    }
    return null;
  }

  Future<OsmData?> fetchLocationByAddress(String address) async {
    var client = await db;

    final Future<List<Map<String, dynamic>>> futureMaps = client.query(
      'location',
      where: 'address = ?',
      whereArgs: [address],
    );
    var maps = await futureMaps;
    if (maps.isNotEmpty) {
      return OsmData.fromDb(maps.first);
    }
    return null;
  }

  Future<int> updateLocation(OsmData location) async {
    var client = await db;

    return client.update(
      'location',
      location.toMapForDb(),
      where: 'id = ?',
      whereArgs: [location.id],
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<int> removeLocation(int id) async {
    var client = await db;

    return client.delete('location', where: 'id = ?', whereArgs: [id]);
  }

  Future<List<OsmData>> locations() async {
    // Get a reference to the database.
    var client = await db;

    // Query the table for all the locations.
    final List<Map<String, Object?>> locationMaps = await client.query(
      'location',
    );

    // Convert the list of each dog's fields into a list of `Dog` objects.
    return [
      for (final {
            'id': id as int,
            'address': address as String,
            'latitude': latitude as double,
            'longitude': longitude as double,
          }
          in locationMaps)
        OsmData.withDisplayName(
          id: id,
          displayName: address,
          location: LatLng(latitude, longitude),
        ),
    ];
  }
}
