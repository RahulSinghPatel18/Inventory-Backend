const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({

name: {
        type: String,
        required: [true, "Category name is required"],
        trim: true
        },
    
organizationId: {
       type: mongoose.Schema.Types.ObjectId,
       ref: "Organization",
       required: true
       },

createdBy: {
       type: mongoose.Schema.Types.ObjectId,
       ref: "User",
       required: true
       }
       }, { timestamps: true });

       categorySchema.index(
{ organizationId: 1, name: 1 },
{ unique: true }
);


const Category = mongoose.model("Category", categorySchema);

module.exports = Category;