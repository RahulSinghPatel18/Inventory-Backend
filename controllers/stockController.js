const mongoose = require("mongoose");
const Product = require("../models/Product");
const StockHistory = require("../models/StockHistory");

    const stockIn = async (req, res) => {
            try {
            const { productId, quantity } = req.body;
            
            if (!mongoose.Types.ObjectId.isValid(productId)) {
              return res.status(400).json({
                message: "Invalid product ID"
              });
            }
            
            if (!quantity || quantity < 1) {
              return res.status(400).json({
                message: "Quantity must be greater than 0"
              });
            }
            
            const product = await Product.findOne({
              _id: productId,
              organizationId: req.user.organizationId
            });
            
            if (!product) {
              return res.status(404).json({
                message: "Product not found"
              });
            }
            
            product.quantity += Number(quantity);
            await product.save();
            
            const history = await StockHistory.create({
              productId: product._id,
              type: "in",
              quantity: Number(quantity),
              organizationId: req.user.organizationId,
              createdBy: req.user.userId
            });
            
            res.status(200).json({
              message: "Stock added successfully",
              product,
              history
            });
    
            } catch (error) {
            res.status(500).json({
            message: "Stock in failed",
            error: error.message
            });
            }
    };





    const stockOut = async (req, res) => {
               try {
               const { productId, quantity } = req.body;
               
               if (!mongoose.Types.ObjectId.isValid(productId)) {
                 return res.status(400).json({
                   message: "Invalid product ID"
                 });
               }
               
               if (!quantity || quantity < 1) {
                 return res.status(400).json({
                   message: "Quantity must be greater than 0"
                 });
               }
               
               const product = await Product.findOne({
                 _id: productId,
                 organizationId: req.user.organizationId
               });
               
               if (!product) {
                 return res.status(404).json({
                   message: "Product not found"
                 });
               }
               
               if (product.quantity < Number(quantity)) {
                 return res.status(400).json({
                   message: "Insufficient stock"
                 });
               }
               
               product.quantity -= Number(quantity);
               await product.save();
               
               const history = await StockHistory.create({
                 productId: product._id,
                 type: "out",
                 quantity: Number(quantity),
                 organizationId: req.user.organizationId,
                 createdBy: req.user.userId
               });
               
               res.status(200).json({
                 message: "Stock removed successfully",
                 productId: product._id,
                 currentStock: product.quantity,
                 history: {
                   type: history.type,
                   quantity: history.quantity
                 }
               });
               
               } catch (error) {
               res.status(500).json({
               message: "Stock out failed",
               error: error.message
               });
               }
    };





  const getStockHistory = async (req, res) => {
try {

const { productId,type,startDate, endDate, page = 1, limit = 10 } = req.query;

const pageNumber = Number(page);
const limitNumber = Number(limit);

if (!Number.isInteger(pageNumber) || pageNumber < 1) {
  return res.status(400).json({
    message: "Page must be a positive integer"
  });
}

if (!Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 100) {
  return res.status(400).json({
    message: "Limit must be between 1 and 100"
  });
}

const filter = {
  organizationId: req.user.organizationId
};

if (productId) {

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({
      message: "Invalid product ID"
    });
  }

  filter.productId = productId;
}


if (type) {
if (!["in", "out"].includes(type)) {
return res.status(400).json({
message: "Type must be either in or out"
});
}

filter.type = type;
}


if (startDate || endDate) {

filter.createdAt = {};

if (startDate) {
const start = new Date(startDate);

if (isNaN(start.getTime())) {
  return res.status(400).json({
    message: "Invalid start date"
  });
}

filter.createdAt.$gte = start;

}

if (endDate) {
const end = new Date(endDate);

if (isNaN(end.getTime())) {
  return res.status(400).json({
    message: "Invalid end date"
  });
}

end.setHours(23, 59, 59, 999);

filter.createdAt.$lte = end;

}
}

const totalHistory = await StockHistory.countDocuments(filter);

const skip = (pageNumber - 1) * limitNumber;

const history = await StockHistory.find(filter)
  .populate("productId", "name price category")
  .populate("createdBy", "name email")
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limitNumber);

const totalPages = Math.ceil(totalHistory / limitNumber);

res.json({
  message: "Stock history fetched successfully",
  page: pageNumber,
  limit: limitNumber,
  totalHistory,
  totalPages,
  hasNextPage: pageNumber < totalPages,
  hasPreviousPage: pageNumber > 1,
  history
});

} catch (error) {
res.status(500).json({
message: "Failed to fetch stock history",
error: error.message
});
}
};






const getLowStock = async (req, res) => {
               try {
               
               const products = await Product.find({
                 organizationId: req.user.organizationId,
                 quantity: { $gt: 0, $lte: 5 }
               });
               
               res.json({
                 message: "Low stock products fetched successfully",
                 count: products.length,
                 products
               });
               
               } catch (error) {
               res.status(500).json({
               message: "Failed to fetch low stock products",
               error: error.message
               });
               }
               };
               


const getOutOfStock = async (req, res) => {
             try {
             
             const products = await Product.find({
               organizationId: req.user.organizationId,
               quantity: 0
             });
             
             res.json({
               message: "Out of stock products fetched successfully",
               count: products.length,
               products
             });
             
             } catch (error) {
             res.status(500).json({
             message: "Failed to fetch out of stock products",
             error: error.message
             });
             }
             };





const getStockSummary = async (req, res) => {
                 try {
                 const { productId } = req.query;
                 
                 if (!productId) {
                   return res.status(400).json({
                     message: "Product ID is required"
                   });
                 }
                 
                 if (!mongoose.Types.ObjectId.isValid(productId)) {
                   return res.status(400).json({
                     message: "Invalid product ID"
                   });
                 }
                 
                 const product = await Product.findOne({
                   _id: productId,
                   organizationId: req.user.organizationId
                 });
                 
                 if (!product) {
                   return res.status(404).json({
                     message: "Product not found"
                   });
                 }
  //  Yahan aggregate() use hua hai.Normal find() se hum records nikal rahe theStockHistory.find(...Lekin yahan hume multiple history records ko calculate karke total chahiye:
                 const summary = await StockHistory.aggregate([
                   {
                     $match: {
                       productId: product._id,
                       organizationId: req.user.organizationId
                     }
                   },
                   {
                     $group: {
                       _id: "$productId",
                       totalStockIn: {
                         $sum: {
                           $cond: [{ $eq: ["$type", "in"] }, "$quantity", 0]
                         }
                       },
                       totalStockOut: {
                         $sum: {
                           $cond: [{ $eq: ["$type", "out"] }, "$quantity", 0]
                         }
                       }
                     }
                   }
                 ]);
                 
                 const stockData = summary[0] || {
                   totalStockIn: 0,
                   totalStockOut: 0
                 };
                 
                 res.json({
                   message: "Stock summary fetched successfully",
                   product: {
                     id: product._id,
                     name: product.name,
                     currentStock: product.quantity
                   },
                   summary: {
                     totalStockIn: stockData.totalStockIn,
                     totalStockOut: stockData.totalStockOut
                   }
                 });
                 
                 } catch (error) {
                 res.status(500).json({
                 message: "Failed to fetch stock summary",
                 error: error.message
                 });
                 }
                 };
                 


module.exports = { stockIn,stockOut ,getStockHistory,getLowStock,getOutOfStock, getStockSummary};