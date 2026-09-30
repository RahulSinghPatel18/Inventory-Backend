const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name :{
        type: String,
        required: [true, "Name is required"],
        trim: true
    },

    email:{
        type: String,
        required: [true, "Email is required"],
        unique: true,
        trim: true
    },

    password:{
        type: String,
        required: [true, "Password is required"],
        trim: true
    },

    role:{
        type: String,
        enum: ["user", "admin"],
        default: "user"
    },

     organizationId: {
         type: mongoose.Schema.Types.ObjectId,
         ref: "Organization",
         required: true
         },
    profileImage: {
        type: String,
        default: ""
}

});


const User = mongoose.model("User", userSchema);

module.exports = User;