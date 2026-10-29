const mongoose = require('mongoose')

const toySchema = new mongoose.Schema({
  label: { type: String, required: true },
  price: Number,
  cat: { type: mongoose.Schema.Types.ObjectId, ref: 'Cat' },
  colors: [String],
}, { timestamps: true })

module.exports = mongoose.model('Toy', toySchema)
