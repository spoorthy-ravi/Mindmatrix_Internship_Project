package com.example.jalsanchay

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.*
import com.example.jalsanchay.ui.*
import com.example.jalsanchay.viewmodels.TrackerViewModel
import com.google.firebase.auth.FirebaseAuth

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val auth = FirebaseAuth.getInstance()
    val startDestination = if (auth.currentUser != null) "dashboard" else "welcome"
    
    val trackerViewModel: TrackerViewModel = viewModel()

    NavHost(navController = navController, startDestination = startDestination) {
        composable("welcome") { WelcomeScreen(navController) }
        composable("login") { LoginScreen(navController) }
        composable("signup") { SignupScreen(navController) }
        composable("setup") { SetupScreen(navController, trackerViewModel) }
        composable("dashboard") { DashboardScreen(navController, trackerViewModel) }
        composable("history") { HistoryScreen(trackerViewModel) }
        composable("tips") { TipsScreen(trackerViewModel) }
    }
}
