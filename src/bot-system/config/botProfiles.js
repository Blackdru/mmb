const profiles = {
  player_types: {
    casual_gamer: {
      name_pool: ['CasualPlayer', 'RelaxedGamer', 'FunSeeker', 'ChillPlayer'],
      behavior: {
        thinking_time: { min: 1500, max: 4000 },
        memory_retention: 0.65,
        mistake_probability: 0.18,
        pattern_preference: 'random',
        focus_duration: 8000,
        distraction_chance: 0.3
      }
    },
    
    competitive_player: {
      name_pool: ['ProGamer', 'ChampionMind', 'WinnerPlayer', 'EliteMemory'],
      behavior: {
        thinking_time: { min: 800, max: 2000 },
        memory_retention: 0.88,
        mistake_probability: 0.06,
        pattern_preference: 'systematic',
        focus_duration: 18000,
        distraction_chance: 0.05
      }
    },
    
    strategic_player: {
      name_pool: ['StrategicMind', 'TacticalPlayer', 'SmartGamer', 'AnalyticalAce'],
      behavior: {
        thinking_time: { min: 1200, max: 3000 },
        memory_retention: 0.82,
        mistake_probability: 0.08,
        pattern_preference: 'methodical',
        focus_duration: 15000,
        distraction_chance: 0.12
      }
    },
    
    inconsistent_player: {
      name_pool: ['InconsistentPlayer', 'MoodGamer', 'VariablePlayer', 'UnpredictableAce'],
      behavior: {
        thinking_time: { min: 600, max: 5000 },
        memory_retention: 0.58,
        mistake_probability: 0.22,
        pattern_preference: 'erratic',
        focus_duration: 6000,
        distraction_chance: 0.35
      }
    }
  },

  time_based_adjustments: {
    morning: {
      speed_factor: 0.95,
      accuracy_factor: 1.08,
      focus_factor: 1.15
    },
    afternoon: {
      speed_factor: 1.0,
      accuracy_factor: 1.0,
      focus_factor: 1.0
    },
    evening: {
      speed_factor: 1.05,
      accuracy_factor: 0.96,
      focus_factor: 0.92
    },
    night: {
      speed_factor: 1.18,
      accuracy_factor: 0.88,
      focus_factor: 0.85
    }
  },

  skill_adaptation: {
    novice_opponent: {
      skill_reduction: 0.25,
      error_increase: 0.15,
      speed_reduction: 0.2
    },
    intermediate_opponent: {
      skill_reduction: 0.1,
      error_increase: 0.05,
      speed_reduction: 0.05
    },
    advanced_opponent: {
      skill_increase: 0.15,
      error_reduction: 0.1,
      speed_increase: 0.1
    },
    expert_opponent: {
      skill_increase: 0.3,
      error_reduction: 0.2,
      speed_increase: 0.2
    }
  },

  behavioral_patterns: {
    mouse_movement: {
      direct_path: {
        probability: 0.4,
        variance: 0.1
      },
      curved_path: {
        probability: 0.35,
        variance: 0.15
      },
      hesitant_path: {
        probability: 0.25,
        variance: 0.2
      }
    },

    click_patterns: {
      confident_click: {
        probability: 0.7,
        delay_range: [50, 150]
      },
      double_check: {
        probability: 0.2,
        delay_range: [200, 500]
      },
      accidental_misclick: {
        probability: 0.1,
        recovery_time: [100, 300]
      }
    },

    memory_behaviors: {
      perfect_recall: {
        probability: 0.3,
        conditions: ['early_game', 'high_focus']
      },
      partial_recall: {
        probability: 0.5,
        accuracy_factor: 0.7
      },
      forgetful: {
        probability: 0.2,
        conditions: ['late_game', 'distracted']
      }
    }
  },

  performance_triggers: {
    win_rate_adjustments: {
      too_high: {
        threshold: 0.6,
        adjustments: {
          increase_errors: 0.1,
          slower_thinking: 0.15,
          reduce_memory: 0.1
        }
      },
      too_low: {
        threshold: 0.4,
        adjustments: {
          reduce_errors: 0.08,
          faster_thinking: 0.1,
          improve_memory: 0.12
        }
      }
    },

    streak_responses: {
      winning_streak: {
        threshold: 3,
        behavior_change: 'increase_pressure'
      },
      losing_streak: {
        threshold: 3,
        behavior_change: 'improve_performance'
      }
    }
  },

  natural_variations: {
    daily_performance: {
      good_day: {
        probability: 0.3,
        performance_boost: 0.15
      },
      average_day: {
        probability: 0.5,
        performance_boost: 0.0
      },
      off_day: {
        probability: 0.2,
        performance_penalty: 0.12
      }
    },

    fatigue_simulation: {
      early_game: {
        performance_factor: 1.0,
        error_rate_modifier: 1.0
      },
      mid_game: {
        performance_factor: 0.98,
        error_rate_modifier: 1.05
      },
      late_game: {
        performance_factor: 0.92,
        error_rate_modifier: 1.15
      }
    }
  },

  advanced_strategies: {
    card_selection_patterns: {
      systematic_search: {
        description: 'Methodical row-by-row exploration',
        implementation: 'sequential'
      },
      center_out: {
        description: 'Start from center and work outward',
        implementation: 'radial'
      },
      corner_preference: {
        description: 'Prefer corner and edge cards',
        implementation: 'positional'
      },
      random_exploration: {
        description: 'No clear pattern',
        implementation: 'random'
      }
    },

    memory_utilization: {
      high_memory_player: {
        retention_rate: 0.9,
        recall_accuracy: 0.85
      },
      average_memory_player: {
        retention_rate: 0.7,
        recall_accuracy: 0.6
      },
      low_memory_player: {
        retention_rate: 0.5,
        recall_accuracy: 0.4
      }
    }
  }
};

module.exports = profiles;