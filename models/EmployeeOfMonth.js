const mongoose = require('mongoose');

const EmployeeOfMonthSchema = new mongoose.Schema({
  employee: {
    type: String,
    required: true,
    unique: true, // 'first' or 'second'
    enum: ['first', 'second']
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  imageUrl: {
    type: String,
    required: true
  },
  imageClass: {
    type: String,
    default: ''
  },
  date: {
    type: String,
    required: true
  },
  updatedBy: {
    type: String
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('EmployeeOfMonth', EmployeeOfMonthSchema);
