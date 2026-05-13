package com.example.jalsanchay.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "rainfall_entries")
data class RainfallEntry(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val date: String,
    val rainfallMm: Double,
    val litersCollected: Double
)

@Entity(tableName = "user_config")
data class UserConfig(
    @PrimaryKey val id: Int = 1,
    val roofArea: Double,
    val tankCapacity: Double,
    val runoffCoefficient: Double
)

@Dao
interface AppDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveConfig(config: UserConfig)

    @Query("SELECT * FROM user_config WHERE id = 1")
    fun getConfig(): Flow<UserConfig?>

    @Insert
    suspend fun insertEntry(entry: RainfallEntry)

    @Query("SELECT * FROM rainfall_entries ORDER BY id DESC")
    fun getAllEntries(): Flow<List<RainfallEntry>>
}
